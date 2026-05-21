import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "node:crypto";
import { CriarClienteInput } from "../handlers/cadastro.js";
const REGIAO = "us-east-2";
export const dynamoClient = new DynamoDBClient({ region: REGIAO });
export async function salvarCliente(dadosFormulario) {
    const company_origin_id = crypto.randomUUID();
    const data_abertura = new Date().toISOString();
    const comando = new PutItemCommand({
        TableName: "gld_client",
        Item: {
            company_origin_id: { S: company_origin_id },
            data_abertura: { S: data_abertura },
            nome_empresa: { S: dadosFormulario.nome_empresa },
            email_corp: { S: dadosFormulario.email_corp },
            telefone: { S: dadosFormulario.telefone },
            potencial_gasto: { N: dadosFormulario.potencial_gasto.toString() },
        },
    });
    await dynamoClient.send(comando);
}
//# sourceMappingURL=dynamo.js.map