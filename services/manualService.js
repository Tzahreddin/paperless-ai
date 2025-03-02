const axios = require('axios');
const OpenAI = require('openai');
const config = require('../config/config');
const emptyVar = null;

class ManualService {
    constructor() {
        if(config.aiProvider === 'custom'){
            this.openai = new OpenAI({
                apiKey: config.custom.apiKey,
                baseUrl: config.custom.apiUrl
            });
        }else{            
            this.openai = new OpenAI({ apiKey: config.openai.apiKey });
            this.ollama = axios.create({
            timeout: 300000
            });
        }
    }

    async writePromptToFile(systemPrompt, truncatedContent) {
        const filePath = './logs/prompt.txt';
        const maxSize = 10 * 1024 * 1024;
      
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxSize) {
            await fs.unlink(filePath); // Delete the file if is biger 10MB
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.warn('[WARNING] Error checking file size:', error);
          }
        }
      
        try {
          await fs.appendFile(filePath, systemPrompt + truncatedContent + '\n\n');
        } catch (error) {
          console.error('[ERROR] Error writing to file:', error);
        }
      }
    
    async analyzeDocument(content, existingTags, provider) {
        try {
        if (provider === 'openai') {
            return this._analyzeOpenAI(content, existingTags);
        } else if (provider === 'ollama') {
            return this._analyzeOllama(content, existingTags);
        } else if (provider === 'custom') {
            return this._analyzeCustom(content, existingTags);
        } else {            
            throw new Error('Invalid provider');
        }
        } catch (error) {
        console.error('Error analyzing document:', error);
        return { tags: [], correspondent: null };
        }
    }
    
    async _analyzeOpenAI(content, existingTags) {
        try {
        const existingTagsList = existingTags
            .map(tag => tag.name)
            .join(', ');
    
        const systemPrompt = process.env.SYSTEM_PROMPT;
        await this.writePromptToFile(systemPrompt, content);
        const response = await this.openai.chat.completions.create({
            model: process.env.OPENAI_MODEL,
            messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: content
            }
            ],
            temperature: 0.3,
        });
    
        let jsonContent = response.choices[0].message.content;
        jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const parsedResponse = JSON.parse(jsonContent);
        try {
            parsedResponse = JSON.parse(jsonContent);
            fs.appendFile('./logs/response.txt', jsonContent, (err) => {
                if (err) throw err;
            });
        } catch (error) {
            console.error('Failed to parse JSON response:', error);
            throw new Error('Invalid JSON response from API');
        }
        
        if (!Array.isArray(parsedResponse.tags) || typeof parsedResponse.correspondent !== 'string') {
            throw new Error('Invalid response structure');
        }
        
        return parsedResponse;
        } catch (error) {
        console.error('Failed to analyze document with OpenAI:', error);
        return { tags: [], correspondent: null };
        }
    }

    async _analyzeCustom(content, existingTags) {
        try {
            const existingTagsList = existingTags
                .map(tag => tag.name)
                .join(', ');
        
            const systemPrompt = process.env.SYSTEM_PROMPT;
        
            const response = await this.openai.chat.completions.create({
                model: config.custom.model,
                messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: content
                }
                ],
                temperature: 0.3,
            });
        
            let jsonContent = response.choices[0].message.content;
            jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            const parsedResponse = JSON.parse(jsonContent);
            
            if (!Array.isArray(parsedResponse.tags) || typeof parsedResponse.correspondent !== 'string') {
                throw new Error('Invalid response structure');
            }
            
            return parsedResponse;
            } catch (error) {
            console.error('Failed to analyze document with OpenAI:', error);
            return { tags: [], correspondent: null };
            }
    }
    
    async _analyzeOllama(content, existingTags) {
        try {
        const prompt = process.env.SYSTEM_PROMPT;

        const getAvailableMemory = async () => {
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const totalMemoryMB = (totalMemory / (1024 * 1024)).toFixed(0);
            const freeMemoryMB = (freeMemory / (1024 * 1024)).toFixed(0);
            return { totalMemoryMB, freeMemoryMB };
        };
        
        const calculateNumCtx = (promptTokenCount, expectedResponseTokens) => {
            const totalTokenUsage = promptTokenCount + expectedResponseTokens;
            const maxCtxLimit = 128000;
            
            const numCtx = Math.min(totalTokenUsage, maxCtxLimit);
            
            console.log('Prompt Token Count:', promptTokenCount);
            console.log('Expected Response Tokens:', expectedResponseTokens);
            console.log('Dynamic calculated num_ctx:', numCtx);
            
            return numCtx;
        };
        
        const calculatePromptTokenCount = (prompt) => {
            return Math.ceil(prompt.length / 4);
        };
        
        const { freeMemoryMB } = await getAvailableMemory();
        const expectedResponseTokens = 1024;
        const promptTokenCount = calculatePromptTokenCount(prompt);
        
        const numCtx = calculateNumCtx(promptTokenCount, expectedResponseTokens);
        
        const response = await this.ollama.post(`${config.ollama.apiUrl}/api/generate`, {
            model: config.ollama.model,
            prompt: prompt,
            stream: false,
            options: {
            temperature: 0.7,
            top_p: 0.9,
            repeat_penalty: 1.1,
            num_ctx: numCtx,
            }
        });
    
        if (!response.data || !response.data.response) {
            console.error('Unexpected Ollama response format:', response);
            throw new Error('Invalid response from Ollama API');
        }

        return this._parseResponse(response.data.response);
        }

        catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error('Timeout bei der Ollama-Anfrage:', error);
            throw new Error('Die Analyse hat zu lange gedauert. Bitte versuchen Sie es erneut.');
        }
        console.error('Error analyzing document with Ollama:', error);
        throw error;
        }
    }
}

module.exports = ManualService; 
