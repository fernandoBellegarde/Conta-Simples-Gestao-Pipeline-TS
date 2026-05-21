import { salvarCliente } from "../services/dynamo.js";
export interface CriarClienteInput {
  nome_empresa: string;
  email_corp: string;
  telefone: string;
  potencial_gasto: number;
}

export const handler = async (event: any) => {
  for (const registro of event.Records) {
    try {
      const dadosFormulario = JSON.parse(registro.body);
      await salvarCliente(dadosFormulario);
    } catch (err) {
      console.error("Erro ao processar o formulario:", err);
    }
  }
};
