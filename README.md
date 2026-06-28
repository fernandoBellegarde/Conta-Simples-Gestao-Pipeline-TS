# Conta Simples — Gestão de Pipeline (TS)

Backend **serverless** em **TypeScript** para gestão do pipeline de clientes da Conta Simples. O sistema cobre todo o ciclo de vida de um cliente — desde o cadastro via formulário web, passando pelo cálculo automático de limite de crédito, registro de gastos (TPV) e, por fim, a consolidação de métricas em um dashboard.

A arquitetura é orientada a eventos sobre **AWS Lambda**, **DynamoDB** (com Streams), **SQS** e **API Gateway**.

---

## Índice

- [Visão geral da arquitetura](#visão-geral-da-arquitetura)
- [Fluxos principais](#fluxos-principais)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Funções Lambda (handlers)](#funções-lambda-handlers)
- [Modelo de dados (DynamoDB)](#modelo-de-dados-dynamodb)
- [Motor de crédito](#motor-de-crédito)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Build e deploy](#build-e-deploy)
- [Frontend e proxy local](#frontend-e-proxy-local)
- [Scripts de teste](#scripts-de-teste)
- [Endpoints da API](#endpoints-da-api)
- [Stack tecnológica](#stack-tecnológica)
- [Licença](#licença)

---

## Visão geral da arquitetura

O sistema é totalmente *event-driven*. Nenhum componente mantém estado próprio — tudo trafega entre serviços gerenciados da AWS:

```
                    ┌──────────────┐
                    │  Frontend    │  (formulário de cadastro)
                    │  index.html  │
                    └──────┬───────┘
                           │  POST /api/clientes
                    ┌──────▼───────┐
                    │ proxy-server │  (dev local — Node http)
                    └──────┬───────┘
                           │
                    ┌──────▼────────────┐
                    │   API Gateway     │
                    └──────┬────────────┘
            ┌──────────────┼─────────────────────────┐
            │              │                          │
       POST /clientes   GET/PUT/DELETE          POST /clientes/{id}/gastos
            │              │                          │
        ┌───▼───┐    ┌─────▼──────────┐         ┌─────▼──────┐
        │  SQS  │    │ buscarClientes │         │    SQS     │
        └───┬───┘    │ atualizarClnt  │         └─────┬──────┘
            │        │ deletarCliente │               │
       ┌────▼─────┐  └─────┬──────────┘         ┌──────▼────────┐
       │ cadastro │        │                    │ processarGasto│
       │ (Lambda) │        │                    │   (Lambda)    │
       └────┬─────┘        │                    └──────┬────────┘
            │              │                           │
            ▼              ▼                           ▼
   ┌─────────────────────────────┐          ┌──────────────────┐
   │  DynamoDB — Tabela Clientes  │          │ DynamoDB — Gastos │
   └──────────────┬──────────────┘          └──────────────────┘
                  │ (DynamoDB Stream)
            ┌─────▼────────┐
            │ motorCredito │  (Lambda — calcula limite)
            └─────┬────────┘
                  ▼
   ┌─────────────────────────────┐
   │  DynamoDB — Tabela Limites   │
   └─────────────────────────────┘
```

---

## Fluxos principais

### 1. Cadastro de cliente
1. O usuário preenche o formulário (`frontend/index.html`).
2. O `POST` chega ao **API Gateway**, que enfileira a mensagem no **SQS**.
3. A Lambda **`cadastro`** consome a fila e persiste o cliente na tabela de clientes do DynamoDB (gerando `company_origin_id` via UUID e `data_abertura`).

### 2. Cálculo automático de limite de crédito
1. A escrita na tabela de clientes dispara um **DynamoDB Stream**.
2. A Lambda **`motorCredito`** recebe o evento, lê o `potencial_gasto` (TPV potencial) e calcula o limite de crédito por faixas.
3. O resultado é gravado na tabela de limites.

### 3. Registro de gastos (TPV real)
1. Um `POST /clientes/{id}/gastos` enfileira a transação no **SQS**.
2. A Lambda **`processarGasto`** valida o valor e persiste o gasto na tabela de gastos.

### 4. Consolidação no dashboard
1. A Lambda **`getDashboardSummary`** faz `Scan` paralelo das tabelas de clientes e limites.
2. Agrupa contas por **cohort** (M0/M1/M2) e por mês, calcula KPIs (total de contas, TPV potencial, limite total concedido) e devolve dados prontos para gráficos.

---

## Estrutura do projeto

```
.
├── src/
│   ├── index.ts                  # entrypoint informativo (log de boot)
│   ├── handlers/                 # funções Lambda
│   │   ├── cadastro.ts           # SQS  → salva cliente
│   │   ├── buscarClientes.ts     # GET  /clientes
│   │   ├── atualizarCliente.ts   # PUT  /clientes/{id}
│   │   ├── deletarCliente.ts     # DELETE /clientes/{id}
│   │   ├── processarGasto.ts     # SQS  → salva gasto
│   │   ├── listarGastos.ts       # GET  /clientes/{id}/gastos
│   │   ├── getDashboardSummary.ts# GET  /dashboard (KPIs + gráficos)
│   │   └── motorCredito.ts       # DynamoDB Stream → calcula limite
│   └── services/
│       └── dynamo.ts             # cliente DynamoDB + salvarCliente()
├── frontend/
│   └── index.html                # formulário de cadastro (SPA simples)
├── tests/                        # scripts locais de teste (não versionados)
│   ├── test-clientes.mjs         # CRUD interativo/automatizado de clientes
│   ├── cadastrarGastos.mjs       # gera gastos fictícios em massa
│   ├── atualizarTUDO.py          # script Python auxiliar
│   └── atualizarPotencial.py
├── proxy-server.js               # servidor de dev (serve o HTML + proxy p/ a API)
├── dist/                         # saída compilada do TypeScript
├── comandos.txt                  # cola de comandos do dia a dia
├── tsconfig.json
└── package.json
```

---

## Funções Lambda (handlers)

| Handler | Gatilho | Responsabilidade |
|---|---|---|
| `cadastro` | SQS | Lê `event.Records`, faz parse do corpo e chama `salvarCliente()`. Gera `company_origin_id` (UUID) e `data_abertura`. |
| `buscarClientes` | API Gateway `GET /clientes` | `Scan` completo da tabela de clientes. |
| `atualizarCliente` | API Gateway `PUT /clientes/{id}` | `UpdateItem` de nome, e-mail, telefone, `potencial_gasto` e `data_conta_aberta`. |
| `deletarCliente` | API Gateway `DELETE /clientes/{id}` | `DeleteItem` pela chave `company_origin_id`. |
| `processarGasto` | SQS | Valida o valor (`> 0`, finito) e grava o gasto com categoria, tipo de pagamento e data. |
| `listarGastos` | API Gateway `GET /clientes/{id}/gastos` | `Query` paginada (loop em `LastEvaluatedKey`) dos gastos do cliente + soma total. |
| `getDashboardSummary` | API Gateway `GET /dashboard` | Agrega KPIs, distribuição por cohort e série temporal mensal. |
| `motorCredito` | DynamoDB Stream | Calcula o limite de crédito a partir do TPV potencial e grava na tabela de limites. |

---

## Modelo de dados (DynamoDB)

O projeto usa **três tabelas**, referenciadas por variáveis de ambiente.

### Tabela de Clientes (`TABELA_DYNAMODB`)
Chave de partição: `company_origin_id` (String — UUID).

| Atributo | Tipo | Descrição |
|---|---|---|
| `company_origin_id` | S | Identificador único do cliente (UUID). |
| `data_abertura` | S | Data ISO de criação do registro. |
| `nome_empresa` | S | Razão social / nome da empresa. |
| `email_corp` | S | E-mail corporativo. |
| `telefone` | S | Telefone de contato. |
| `potencial_gasto` | N | TPV potencial mensal estimado. |
| `data_conta_aberta` | S | Preenchido via atualização (opcional). |

> A tabela de clientes deve ter **DynamoDB Streams habilitado** (`NEW_IMAGE`) para alimentar o `motorCredito`.

### Tabela de Gastos (`TABELA_GASTO_DB`)
Chave de partição: `company_origin_id`. Recomenda-se `data_do_gasto` como chave de ordenação.

| Atributo | Tipo | Descrição |
|---|---|---|
| `company_origin_id` | S | Cliente dono do gasto. |
| `data_do_gasto` | S | Data ISO da transação. |
| `valor` | N | Valor da transação. |
| `tipo_pagamento` | S | `crédito`, `débito`, `boleto`, `pix`… |
| `categoria` | S | Categoria da despesa. |

### Tabela de Limites (`TABELA_LIMIT_DB`)
Chave de partição: `company_origin_id`.

| Atributo | Tipo | Descrição |
|---|---|---|
| `company_origin_id` | S | Cliente. |
| `nome_empresa` | S | Nome (denormalizado para o dashboard). |
| `limite_credito` | N | Limite calculado (inteiro). |
| `tpv_potencial` | N | TPV usado no cálculo. |
| `atualizado_em` | S | Data ISO da última atualização. |

---

## Motor de crédito

O `motorCredito` aplica faixas progressivas sobre o **TPV potencial** (`potencial_gasto`):

| Faixa de TPV potencial | Multiplicador | Limite resultante |
|---|---|---|
| `< 100.000` | — | `0` (sem limite) |
| `100.000` a `< 500.000` | `0,7` | `TPV × 0,7` |
| `500.000` a `< 100.000.000` | `1,1` | `TPV × 1,1` |
| `≥ 100.000.000` | `1,3` | `TPV × 1,3` |

O valor final é arredondado para baixo (`Math.floor`). O handler também normaliza valores de TPV que chegam como string formatada (ex.: `"1.234,56"` → `1234.56`).

---

## Variáveis de ambiente

Crie um arquivo `.env` na raiz (não versionado). Chaves usadas pelo projeto:

| Variável | Usada por | Descrição |
|---|---|---|
| `TABELA_DYNAMODB` | cadastro, buscar, atualizar, deletar, dashboard | Nome da tabela de clientes. |
| `TABELA_GASTO_DB` | processarGasto, listarGastos | Nome da tabela de gastos. |
| `TABELA_LIMIT_DB` | motorCredito, dashboard | Nome da tabela de limites. |
| `API_AWS_CLIENTES` | proxy-server, scripts de teste | URL do endpoint `/clientes` no API Gateway. |
| `API_BASE_URL` | scripts de teste | URL base alternativa da API. |

Exemplo (`.env.example`):

```dotenv
TABELA_DYNAMODB=clientes
TABELA_GASTO_DB=gastos
TABELA_LIMIT_DB=limites
API_AWS_CLIENTES=https://xxxx.execute-api.us-east-2.amazonaws.com/prod/clientes
API_BASE_URL=https://xxxx.execute-api.us-east-2.amazonaws.com/prod
```

> **Região AWS:** as Lambdas usam `us-east-2` (algumas instanciam o cliente com a região explícita, outras herdam do ambiente).

---

## Pré-requisitos

- **Node.js** 18+ (recomendado 20+; o `package.json` usa `"type": "module"`).
- **TypeScript** 6.x (declarado em `devDependencies`).
- Conta **AWS** com permissões para Lambda, DynamoDB, SQS e API Gateway.
- Credenciais AWS configuradas localmente (para os scripts e deploy).

---

## Instalação

```bash
git clone https://github.com/fernandoBellegarde/Conta-Simples-Gest-o-Pipeline-TS.git
cd Conta-Simples-Gest-o-Pipeline-TS
npm install
```

---

## Build e deploy

O TypeScript é compilado para `dist/` (`rootDir: ./src`, `outDir: ./dist`).

```bash
# Compilar
npx tsc

# Empacotar para deploy na Lambda
cp package.json dist/ && cd dist && zip -r ../funcao.zip . && cd ..
```

Em seguida, faça o upload de `funcao.zip` para cada função Lambda (ou via console / IaC). Cada handler corresponde a uma função, configurada com seu respectivo gatilho (SQS, API Gateway ou DynamoDB Stream) e variáveis de ambiente.

> Atalhos equivalentes estão anotados em `comandos.txt`.

---

## Frontend e proxy local

O `proxy-server.js` serve o formulário e encaminha as requisições para o API Gateway (contornando CORS em desenvolvimento). Ele lê `API_AWS_CLIENTES` do `.env`.

```bash
npm run serve
# ✓ Servidor rodando em http://localhost:3000
```

- `GET /` → entrega `frontend/index.html`.
- `POST /api/clientes` → repassa o corpo para a `API_AWS_CLIENTES` (HTTPS).

---

## Scripts de teste

> Os scripts ficam em `tests/` e **não são versionados** (`.gitignore`). Eles batem direto na API real configurada no `.env`.

### CRUD de clientes — `test-clientes.mjs`

```bash
# Fluxo completo automatizado: POST → (espera SQS) → GET → PUT → DELETE
node tests/test-clientes.mjs

# Comandos individuais
node tests/test-clientes.mjs post          # POST interativo
node tests/test-clientes.mjs get           # lista clientes
node tests/test-clientes.mjs put <id>      # PUT interativo (Enter mantém valor atual)
node tests/test-clientes.mjs delete <id>   # remove cliente
```

### Geração de gastos fictícios — `cadastrarGastos.mjs`

Gera transações para ~70% da base, distribuídas nos últimos 3 meses (M0/M1/M2), e envia via `POST /clientes/{id}/gastos`.

```bash
node tests/cadastrarGastos.mjs --dry-run   # gera e mostra, NÃO envia
node tests/cadastrarGastos.mjs             # gera, mostra resumo e pede confirmação
node tests/cadastrarGastos.mjs --yes       # envia sem confirmar
```

---

## Endpoints da API

| Método | Rota | Handler | Descrição |
|---|---|---|---|
| `POST` | `/clientes` | `cadastro` (via SQS) | Cadastra um cliente (assíncrono). |
| `GET` | `/clientes` | `buscarClientes` | Lista todos os clientes. |
| `PUT` | `/clientes/{id}` | `atualizarCliente` | Atualiza um cliente. |
| `DELETE` | `/clientes/{id}` | `deletarCliente` | Remove um cliente. |
| `POST` | `/clientes/{id}/gastos` | `processarGasto` (via SQS) | Registra um gasto (assíncrono). |
| `GET` | `/clientes/{id}/gastos` | `listarGastos` | Lista gastos do cliente + total. |
| `GET` | `/dashboard` | `getDashboardSummary` | KPIs, distribuição por cohort e série mensal. |

### Exemplo — payload de cadastro

```json
{
  "nome_empresa": "Tech Solutions Ltda",
  "email_corp": "contato@empresa.com.br",
  "telefone": "11 98765-4321",
  "potencial_gasto": 50000
}
```

### Exemplo — resposta do dashboard

```json
{
  "totalContas": 120,
  "totalTPVPotencial": 8500000,
  "totalLimiteConcedido": 6200000,
  "distribuicaoCohort": [
    { "cohort": "M0", "label": "Este mês",      "total": 30 },
    { "cohort": "M1", "label": "Mês passado",   "total": 45 },
    { "cohort": "M2", "label": "2 meses atrás", "total": 25 }
  ],
  "serieContas": [
    { "mes": "2026-04", "total": 25 },
    { "mes": "2026-05", "total": 45 },
    { "mes": "2026-06", "total": 30 }
  ]
}
```

> **Cohorts:** `M0` = conta aberta no mês atual, `M1` = mês passado, `M2` = dois meses atrás, `M3+` = mais antigas (fora do pipeline principal).

---

## Stack tecnológica

- **Linguagem:** TypeScript (ESM, `module: nodenext`, `target: esnext`, `strict`).
- **Runtime:** Node.js / AWS Lambda.
- **Banco:** Amazon DynamoDB (+ DynamoDB Streams).
- **Mensageria:** Amazon SQS.
- **API:** Amazon API Gateway.
- **SDK:** AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/client-sqs`, `@aws-sdk/util-dynamodb`).
- **Frontend:** HTML + CSS + JavaScript puro (sem framework).

---

## Licença

Distribuído sob a licença definida em [`LICENSE`](./LICENSE).
