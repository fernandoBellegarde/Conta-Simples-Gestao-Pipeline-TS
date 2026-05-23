import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

const dynamoClient = new DynamoDBClient({});

export const handler = async (event: any) => {
  try {
    console.log("Iniciando exclusão de um cliente");

    const table = process.env.TABELA_DYNAMODB;
    if (!table) {
      throw new Error(
        "Falta a variavel TABELA_DYNAMODB para excluir um cliente",
      );
    }

    // Isso captura o ID que vira na URL da API Gateaway (ex: xx/clientes/id_do_cliente)
    const clientId = event.pathParameters?.id;

    if (!clientId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          mensagem: "ID do cliente não fornecido na URL",
        }),
      };
    }

    const command = new DeleteItemCommand({
      TableName: table,
      Key: {
        company_origin_id: { S: clientId },
      },
    });

    await dynamoClient.send(command);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        mensagem: `Cliente ${clientId} deletado com sucesso!`,
      }),
    };
  } catch (error) {
    console.error("Erro ao deletar cliente no DynamoDB:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ mensagem: "Erro interno ao deletar cliente" }),
    };
  }
};
