import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { SQSEvent } from "aws-lambda";

const cliente = new DynamoDBClient({ region: "us-east-2" });
const tableName = process.env.TABELA_GASTO_DB;
if (!tableName) {
  throw new Error("Falta a variavel TABELA_GASTO_DB");
}

export const handler = async (event: SQSEvent) => {
  console.log("Iniciando processamento de mensagens de gastos do SQS");

  for (const record of event.Records) {
    try {
      const body =
        typeof record.body === "string" ? JSON.parse(record.body) : record.body;
      console.log("Processando gasto para a empresa:", body.company_origin_id);

      const valor = Number(body.valor);
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new Error(`Valor de gasto inválido: ${body.valor}`);
      }

      const command = new PutItemCommand({
        TableName: tableName,
        Item: {
          company_origin_id: { S: body.company_origin_id },
          data_do_gasto: { S: body.data_da_compra || new Date().toISOString() },
          valor: { N: String(valor) },
          tipo_pagamento: { S: body.tipo_pagamento || "crédito" },
          categoria: {
            S: body.categoria_da_compra || body.categoria || "Geral",
          },
        },
      });

      await cliente.send(command);
      console.log("Gasto salvo com sucesso no DynamoDB");
    } catch (error) {
      console.error("Erro ao processar registro individual do SQS:", error);
      throw error;
    }
  }
};
