import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const dynamoClient = new DynamoDBClient({});

export const handler = async (event: any) => {
  try {
    console.log("Iniciando busca de clientes..");

    const table = process.env.TABELA_DYNAMODB;
    if (!table) {
      throw new Error("Variavel table do env não processada");
    }

    // Comando Scan varre a tabela
    const command = new ScanCommand({
      TableName: table,
    });

    const data = await dynamoClient.send(command);

    return {
      statusCode: 200,
      headers: {
        "Content-Type0": "application/json",
        "Acess-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data.Items || []),
    };
  } catch (err) {
    console.error("Erro ao buscar clientes no DynamoDB:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ mensagem: "Erro interno ao buscar clientes" }),
    };
  }
};
