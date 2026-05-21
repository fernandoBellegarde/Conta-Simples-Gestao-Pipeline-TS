import { salvarCliente } from "../services/dynamo.js";
export const handler = async (event) => {
    for (const registro of event.Records) {
        try {
            const dadosFormulario = JSON.parse(registro.body);
            await salvarCliente(dadosFormulario);
        }
        catch (err) {
            console.error("Erro ao processar o formulario:", err);
        }
    }
};
//# sourceMappingURL=cadastro.js.map