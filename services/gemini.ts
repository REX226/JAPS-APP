import { GoogleGenAI } from "@google/genai";

export const generateAlertContent = async (topic: string, severity: string): Promise<string> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.warn("API Key is missing. AI generation disabled.");
    return "Error: API Key missing. Please check configuration.";
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
      Write a concise, authoritative emergency alert message about: "${topic}".
      Severity Level: ${severity}.
      The message should be suitable for a broadcast system. 
      Keep it under 30 words. Do not use markdown.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text?.trim() || "Alert generated but empty response.";
  } catch (error) {
    console.error("Gemini generation error:", error);
    throw new Error("Failed to generate alert content.");
  }
};