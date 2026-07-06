import { salvarCliente } from "../services/dynamo.js";
export interface CriarClienteInput {
  nome_empresa: string;
  email_corp: string;
  telefone: string;
  potencial_gasto: number;
  // Opcional: quando informado, define a data de abertura (ISO). Usado pelos
  // seeds de cohort (M0/M1/M2). Se ausente, o salvarCliente usa a data atual.
  data_conta_aberta?: string;
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
