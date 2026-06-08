import {
  DynamoDBClient,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";

const client = new DynamoDBClient({ region: "us-east-2" });
const tableName = process.env.TABELA_GASTO_DB;
if (!tableName) {
  throw new Error("Falta a variavel TABELA_GASTO_DB para listar gastos");
}

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    // Pega o ID do cliente dos parâmetros da rota (clientes/{id}/gastos)
    const clientId = event.pathParameters?.id;

    if (!clientId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ message: "O ID do cliente está ausente" }),
      };
    }

    // Pagina a Query (cada chamada retorna no máximo 1MB) para
    // garantir que todos os gastos do cliente sejam somados
    const items: Record<string, AttributeValue>[] = [];
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

    do {
      const command = new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "company_origin_id = :id",
        ExpressionAttributeValues: {
          ":id": { S: clientId },
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await client.send(command);
      items.push(...(response.Items || []));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    let totalGastos = 0;

    const gastosFormatados = items.map((item) => {
      const valor = Number(item.valor?.N ?? 0);
      totalGastos += valor;
      return {
        data_do_gasto: item.data_do_gasto?.S,
        valor: valor,
        tipo_pagamento: item.tipo_pagamento?.S,
        categoria: item.categoria?.S,
      };
    });

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ gastos: gastosFormatados, totalGastos }),
    };
  } catch (error) {
    console.error("Erro ao listar gastos:", error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Erro interno do servidor" }),
    };
  }
};
