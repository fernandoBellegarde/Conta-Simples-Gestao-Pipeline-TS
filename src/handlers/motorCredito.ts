import {
  DynamoDBClient,
  UpdateItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-2" });

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

      let gastoCru = cliente.potencial_gasto;

      if (typeof gastoCru === "string") {
        gastoCru = gastoCru.replace(/\./g, "").replace(/,/g, ".");
      }
      const tpvPotencial = Number(gastoCru || 0);

      console.log(
        `Calculando limite. Cliente: ${clienteId} | TPV Potencial: ${tpvPotencial}`,
      );

      let limiteConcedido = 0;
      if (tpvPotencial >= 100000 && tpvPotencial < 500000) {
        limiteConcedido = tpvPotencial * 0.7;
      } else if (tpvPotencial >= 500000 && tpvPotencial < 100000000) {
        limiteConcedido = tpvPotencial * 1.1;
      } else if (tpvPotencial >= 100000000) {
        limiteConcedido = tpvPotencial * 1.3;
      }

      let limiteFormatado = Math.floor(limiteConcedido);

      console.log("Salvando na tabela gld_limit...");
      await client.send(
        new PutItemCommand({
          TableName: limitTableName,
          Item: {
            company_origin_id: { S: String(clienteId) },
            nome_empresa: {
              S: cliente.nome_empresa || cliente.nome || "Sem nome",
            },
            limite_credito: { N: String(limiteFormatado) },
            tpv_potencial: { N: String(tpvPotencial) },
            atualizado_em: { S: new Date().toISOString() },
          },
        }),
      );
    } catch (error) {
      console.error("Erro crítico ao processar registro:", error);
    }
  }
};
