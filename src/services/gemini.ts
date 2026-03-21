import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type SummaryMode = "communication" | "account_actions" | "group_update" | "client_response";

export async function summarizeChat(
  chatText: string, 
  mode: SummaryMode = "communication",
  imageData?: { data: string; mimeType: string },
  audioData?: { data: string; mimeType: string }
) {
  const model = "gemini-3-flash-preview";
  
  const audioInstruction = `
    IMPORTANTE: Se um arquivo de áudio for fornecido, sua primeira tarefa é transcrever o conteúdo do áudio com precisão. 
    Use essa transcrição como base (ou complemento ao texto fornecido) para gerar o conteúdo solicitado.
    Se o áudio ou texto for uma instrução direta (ex: "Peça o acesso ao cliente"), trate como um prompt para gerar a mensagem final.
    
    REGRA CRÍTICA: Não adicione NENHUM texto de introdução ou conclusão (ex: "Aqui está o resumo", "Espero que ajude"). 
    Retorne APENAS o conteúdo estruturado solicitado.
  `;

  const communicationInstruction = `
    Você é um assistente especializado em resumir conversas de grupos de WhatsApp.
    ${audioInstruction}
    Sua tarefa é analisar o log da conversa e/ou o áudio fornecido e gerar um resumo estruturado contendo:
    
    1. **Visão Geral**: Um parágrafo curto sobre o tema principal da conversa.
    2. **Tópicos Principais**: Uma lista dos assuntos discutidos.
    3. **Decisões e Combinados**: O que foi decidido ou agendado.
    4. **Participantes Ativos**: Quem mais interagiu (sem expor dados sensíveis).
    5. **Clima da Conversa**: Se foi amigável, tenso, produtivo, etc.
    
    Formate a saída em Markdown elegante. Use negrito para nomes e datas importantes.
  `;

  const accountActionsInstruction = `
    Você é um especialista em tráfego pago (Meta Ads e Google Ads) e gestor de contas sênior.
    ${audioInstruction}
    Sua tarefa é analisar o log da conversa, o áudio e/ou o print das campanhas fornecido para gerar um relatório de "Ações Específicas da Conta" pronto para o Monday.com.
    
    ESTRATÉGIA:
    - Se o input for uma sugestão sobre **quando** enviar relatórios ou executar ações, incorpore isso como uma recomendação estratégica no relatório.
    - Analise se as métricas justificam o envio imediato de um report ou se devemos aguardar mais dados.
    
    FOCO DO RELATÓRIO:
    - **O que foi executado**: Ações práticas realizadas na conta.
    - **Pontos Positivos**: Resultados satisfatórios, KPIs batidos ou melhorias observadas.
    - **Ações de Melhoria**: O que foi feito ou será feito para otimizar ainda mais os resultados.
    
    REGRAS DE FORMATAÇÃO (MONDAY.COM):
    - Use **negrito** para títulos de seção e métricas importantes.
    - Use listas com marcadores.
    - Deixe DUAS linhas de espaço entre cada seção.
    - Linguagem: Profissional, analítica e focada em performance.
    
    ESTRUTURA:
    **RESUMO DE PERFORMANCE**
    (Visão geral dos resultados baseada no texto/imagem/áudio)
    
    **AÇÕES EXECUTADAS**
    - [Ação]
    
    **PONTOS POSITIVOS**
    - [Resultado/KPI]
    
    **OTIMIZAÇÕES E MELHORIAS**
    - [O que foi feito para melhorar]
  `;

  const groupUpdateInstruction = `
    Você é um gestor de tráfego sênior e parceiro estratégico.
    ${audioInstruction}
    Sua tarefa é gerar uma atualização RESUMIDA e PROFISSIONAL para o grupo de WhatsApp do cliente.
    
    DIRETRIZES DE CONTEÚDO:
    - **Foco em Resultados**: O cliente quer ver o valor gerado. Relacione as ações aos resultados.
    - **Métricas Chave**: Sempre que disponíveis, inclua dados de **ROAS**, **Mensagens no WhatsApp**, **Leads** e **Conversões**.
    - **Brevidade Estratégica**: Seja direto, mas traga os números que comprovam a boa performance.
    - **Tom Profissional e Amigável**: Transmita segurança de que as campanhas estão saudáveis e evoluindo.
    - **Sugestão de Envio**: Se o usuário perguntar "quando enviar", sugira o melhor momento baseado no volume de dados ou urgência dos resultados.
    - **Sem Emojis**: Não utilize emoticons ou emojis.
    
    ESTRUTURA SUGERIDA:
    1. **Saudação cordial**.
    2. **Ações Realizadas**: 1 ou 2 pontos principais do que foi otimizado.
    3. **Resultados Alcançados**: Destaque ROAS, mensagens, leads e conversões de forma clara.
    4. **Conclusão e Próximo Passo**: Uma frase curta sobre a continuidade do trabalho.
    
    FORMATO:
    - Use **negrito** para destacar os números e métricas principais.
    - Texto organizado para leitura rápida e profissional.
  `;

  const clientResponseInstruction = `
    Você é um especialista em Atendimento ao Cliente e Sucesso do Cliente (Customer Success) focado em tráfego pago.
    ${audioInstruction}
    Sua tarefa é redigir uma resposta para um cliente ou um comunicado que seja HUMANIZADA, CONCISA e CLARA.
    
    DIRETRIZES DE ESTILO:
    - **Concisa e Direta**: Evite textos longos. Vá direto ao ponto de forma elegante e rápida.
    - **Humanizada**: Fuja do tom robótico ou excessivamente formal. Fale como um parceiro real que se importa com o sucesso do cliente.
    - **Tranquilidade**: O tom deve ser calmante. O cliente deve se sentir seguro e bem cuidado ao ler.
    - **Profissionalismo Extremo**: Seja impecável na ética e na forma. Não deve haver margem para interpretações negativas ou ofensivas.
    - **Presença e Melhoria Contínua**: Reforce que você está presente, acompanhando de perto e implementando melhorias constantes.
    - **Sem Emojis**: Mantenha a estética profissional e limpa.
    
    ESTRUTURA DA RESPOSTA (FOCO EM BREVIDADE):
    1. **Saudação amigável**.
    2. **Ação/Resposta**: O que está sendo feito ou a resposta direta à dúvida, mostrando proatividade.
    3. **Segurança e Relacionamento**: Uma frase curta reforçando a parceria e o monitoramento constante.
    4. **Fechamento cordial**.
  `;

  let systemInstruction = communicationInstruction;
  if (mode === "account_actions") systemInstruction = accountActionsInstruction;
  if (mode === "group_update") systemInstruction = groupUpdateInstruction;
  if (mode === "client_response") systemInstruction = clientResponseInstruction;

  const parts: any[] = [{ text: chatText || "Analise os arquivos anexos para gerar o relatório/resumo." }];
  
  if (imageData) {
    parts.push({
      inlineData: {
        data: imageData.data,
        mimeType: imageData.mimeType,
      },
    });
  }

  if (audioData) {
    parts.push({
      inlineData: {
        data: audioData.data,
        mimeType: audioData.mimeType,
      },
    });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: {
        systemInstruction,
        temperature: 0.4,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error summarizing chat:", error);
    throw new Error("Falha ao gerar o resumo. Verifique se o texto ou imagem são válidos.");
  }
}

export async function transcribeAudio(audioData: { data: string; mimeType: string }) {
  const model = "gemini-3-flash-preview";
  const systemInstruction = "Você é um assistente de transcrição altamente preciso. Sua única tarefa é transcrever o áudio fornecido palavra por palavra, sem adicionar comentários, resumos ou formatação extra. Apenas o texto falado.";
  
  const parts = [
    { text: "Transcreva este áudio exatamente como falado." },
    {
      inlineData: {
        data: audioData.data,
        mimeType: audioData.mimeType,
      },
    }
  ];

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: {
        systemInstruction,
        temperature: 0.1,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    throw new Error("Falha ao transcrever o áudio.");
  }
}

export async function summarizeHistory(
  historyRecords: { mode: SummaryMode; content: string; createdAt: string }[],
  period: string
) {
  const model = "gemini-3-flash-preview";
  const systemInstruction = `
    Você é um gestor de contas sênior e estrategista de tráfego pago.
    Sua tarefa é analisar um conjunto de registros de histórico de atividades de um cliente e gerar um RELATÓRIO EXECUTIVO DE PERÍODO (${period}).
    
    ESTRUTURA OBRIGATÓRIA DO RELATÓRIO:
    1. **Período Analisado**: Mencione claramente o período: ${period}.
    2. **Resumo por Etapas**:
       - **Comunicados (Monday)**: Se houver, resuma os principais comunicados. Se não houver, mencione "Sem comunicados no período".
       - **Ações na Conta (Monday)**: Se houver, resuma as ações executadas. Se não houver, mencione "Sem ações registradas na conta".
       - **Atualizações do Grupo**: Se houver, resuma as atualizações enviadas. Se não houver, mencione "Sem atualizações de grupo".
       - **Respostas ao Cliente**: Se houver, resuma as respostas enviadas ou pendentes. Se não houver, mencione "Sem respostas registradas".
    3. **Conclusão Estratégica**: Um parágrafo final sobre a saúde da conta e próximos passos baseados no histórico.

    DIRETRIZES:
    - O tom deve ser profissional, analítico e focado em valor estratégico.
    - Formate em Markdown elegante.
    - Seja conciso mas informativo em cada etapa.
    
    REGRA: Não adicione introduções ou conclusões genéricas fora da estrutura solicitada.
  `;

  const historyText = historyRecords.map(r => 
    `[${r.createdAt}] [${r.mode.toUpperCase()}]: ${r.content}`
  ).join("\n\n---\n\n");

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: `Aqui está o histórico do período ${period}:\n\n${historyText}` }] }],
      config: {
        systemInstruction,
        temperature: 0.3,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error summarizing history:", error);
    throw new Error("Falha ao gerar o resumo do histórico.");
  }
}

export async function generateGroupMessageFromHistory(
  historySummary: string
) {
  const model = "gemini-3-flash-preview";
  const systemInstruction = `
    Você é um gestor de tráfego sênior.
    Sua tarefa é transformar um resumo técnico de atividades em uma MENSAGEM DE ATUALIZAÇÃO para o grupo de WhatsApp do cliente.
    
    DIRETRIZES:
    - Seja conciso, profissional e amigável.
    - Fale sobre o que foi feito e os resultados de forma clara.
    - Use negrito para métricas importantes.
    - Sem emojis.
    - O objetivo é transmitir segurança e transparência sobre o trabalho realizado no período.
    
    REGRA: Retorne APENAS o texto da mensagem pronta para envio.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: `Gere uma mensagem de WhatsApp baseada neste resumo de atividades:\n\n${historySummary}` }] }],
      config: {
        systemInstruction,
        temperature: 0.5,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error generating group message:", error);
    throw new Error("Falha ao gerar a mensagem para o grupo.");
  }
}
