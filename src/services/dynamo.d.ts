import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CriarClienteInput } from "../handlers/cadastro.js";
export declare const dynamoClient: DynamoDBClient;
export declare function salvarCliente(dadosFormulario: CriarClienteInput): Promise<void>;
//# sourceMappingURL=dynamo.d.ts.map