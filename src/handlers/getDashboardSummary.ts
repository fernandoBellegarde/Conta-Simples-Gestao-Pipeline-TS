import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";

const client = new DynamoDBClient({ region: "us-east-2" });

// ─── helpers ────────────────────────────────────────────────────────────────

function getMesAno(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Retorna o label de cohort do cliente:
//   M0 = abriu no mês atual
//   M1 = abriu no mês passado
//   M2 = abriu dois meses atrás
//   M3+ = mais antigo que M2 (não entra no pipeline principal)
function getCohort(dataAbertura: string): "M0" | "M1" | "M2" | "M3+" {
  const agora = new Date();
  const abertura = new Date(dataAbertura);

  const diffMeses =
    (agora.getFullYear() - abertura.getFullYear()) * 12 +
    (agora.getMonth() - abertura.getMonth());

  if (diffMeses === 0) return "M0";
  if (diffMeses === 1) return "M1";
  if (diffMeses === 2) return "M2";
  return "M3+";
}

// ─── scan helpers ────────────────────────────────────────────────────────────

async function scanAll(tableName: string): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(res.Items || []).map((i) => unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

// ─── handler ─────────────────────────────────────────────────────────────────

export const handler = async (_event: APIGatewayProxyEvent) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const tabelaCliente = process.env.TABELA_DYNAMODB;
    const tabelaLimit = process.env.TABELA_LIMIT_DB;

    if (!tabelaCliente || !tabelaLimit) {
      throw new Error(
        "Variáveis de ambiente TABELA_DYNAMODB ou TABELA_LIMIT_DB não configuradas",
      );
    }

    // Busca as 2 tabelas em paralelo — sem custo extra de latência
    const [clientes, limites] = await Promise.all([
      scanAll(tabelaCliente),
      scanAll(tabelaLimit),
    ]);

    // Monta um map de limite por cliente para lookup O(1)
    const limiteMap = new Map<string, number>(
      limites.map((l) => [l.company_origin_id, Number(l.limite_credito ?? 0)]),
    );

    // ── Métricas globais ──────────────────────────────────────────────────────

    let totalTPV = 0;
    let totalLimite = 0;

    // Agrupamento por cohort: { M0: [], M1: [], M2: [], anterior: [] }
    const porCohort: Record<string, number> = {
      M0: 0,
      M1: 0,
      M2: 0,
      anterior: 0,
    };

    // Agrupamento por mês (para o gráfico de linha de crescimento)
    const porMes: Record<string, number> = {};

    for (const c of clientes) {
      const tpv = Number(c.potencial_gasto ?? 0);
      totalTPV += tpv;
      totalLimite += limiteMap.get(c.company_origin_id) ?? 0;

      const cohort = getCohort(c.data_abertura);
      porCohort[cohort] = (porCohort[cohort] ?? 0) + 1;

      const mes = getMesAno(new Date(c.data_abertura));
      porMes[mes] = (porMes[mes] ?? 0) + 1;
    }

    // ── Série temporal ordenada (para o LineChart) ────────────────────────────

    const serieContas = Object.entries(porMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, total]) => ({ mes, total }));

    // ── Distribuição de cohort (para o BarChart) ──────────────────────────────

    const distribuicaoCohort = [
      { cohort: "M0", label: "Este mês", total: porCohort.M0 },
      { cohort: "M1", label: "Mês passado", total: porCohort.M1 },
      { cohort: "M2", label: "2 meses atrás", total: porCohort.M2 },
    ];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        // KPI cards
        totalContas: clientes.length,
        totalTPVPotencial: totalTPV,
        totalLimiteConcedido: totalLimite,

        // Gráficos
        distribuicaoCohort, // BarChart — contas abertas por cohort
        serieContas, // LineChart — crescimento acumulado por mês
      }),
    };
  } catch (err) {
    console.error("Erro ao gerar dashboard summary:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ mensagem: "Erro interno ao gerar o dashboard" }),
    };
  }
};
