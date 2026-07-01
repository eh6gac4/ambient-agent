import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'cf-worker/.dev.vars' });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'Hello! Are you working?',
    });
    console.log("Success:", response.text);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
