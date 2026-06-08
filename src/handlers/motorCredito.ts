import {
  DynamoDBClient,
  UpdateItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-2" });
const tableName = process.env.TABELA_DYNAMODB;
if (!tableName) {
  throw new Error("Falta a variavel TABELA_DYNAMODB para o motor de crédito");
}

const limitTableName = process.env.TABELA_LIMIT_DB;
if (!limitTableName) {
  throw new Error("Falta a variavel TABELA_LIMIT_DB para o motor de crédito");
}

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const record of event.Records) {
    if (record.eventName === "REMOVE" || !record.dynamodb?.NewImage) continue;

    try {
      const cliente = unmarshall(record.dynamodb.NewImage as any);

      console.log(
        "DADOS REAIS RECEBIDOS DO STREAM:",
        JSON.stringify(cliente, null, 2),
      );

      const clienteId = cliente.company_origin_id;

      // 🔍 CORREÇÃO: Lendo a coluna correta do seu banco de dados
      let gastoCru = cliente.potencial_gasto;

      // Tratamento caso o valor venha como string formatada (ex: "900.000")
      if (typeof gastoCru === "string") {
        gastoCru = gastoCru.replace(/\./g, "").replace(/,/g, ".");
      }
      const tpvPotencial = Number(gastoCru || 0);

      console.log(
        `Calculando limite. Cliente: ${clienteId} | TPV Potencial: ${tpvPotencial}`,
      );

      // REGRA DO MOTOR DE CRÉDITO (0.30% para TPV >= 100k)
      let limiteConcedido = 0;
      if (tpvPotencial >= 100000) {
        limiteConcedido = tpvPotencial * 0.003;
      }

      // 1. SALVA NA TABELA AUXILIAR gld_limit (Para o seu Dashboard do Front-end)
      console.log("Salvando na tabela gld_limit...");
      await client.send(
        new PutItemCommand({
          TableName: limitTableName,
          Item: {
            company_origin_id: { S: String(clienteId) },
            nome_empresa: {
              S: cliente.nome_empresa || cliente.nome || "Sem nome",
            },
            limite_credito: { N: String(limiteConcedido) },
            tpv_potencial: { N: String(tpvPotencial) }, // Salvando o valor numérico correto
            atualizado_em: { S: new Date().toISOString() },
          },
        }),
      );

      // 2. ATUALIZAR A TABELA PRINCIPAL gld_client SE HOUVER CRÉDITO CONCEDIDO
      if (limiteConcedido > 0) {
        console.log(
          `Atualizando gld_client com o limite de: R$ ${limiteConcedido}`,
        );
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { company_origin_id: { S: String(clienteId) } },
            UpdateExpression: "SET limite_credito = :limite",
            ExpressionAttributeValues: {
              ":limite": { N: String(limiteConcedido) },
            },
          }),
        );
      }
    } catch (error) {
      console.error("Erro crítico ao processar registro:", error);
    }
  }
};
