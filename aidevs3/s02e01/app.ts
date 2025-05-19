import { OpenAIService } from "../../audio/OpenAIService";
import * as fs from 'fs';
import * as path from 'path';
import { ExpenseCounter } from "../shared/ExpenseCounter";
import type OpenAI from "openai";
import { HeadquartersService } from "../shared/HeadquartersService.ts";
import { RequestService } from "../shared/RequestService";
import { cachedTranscriptions } from "./transcriptions";
const openaiService = new OpenAIService();

const expenseCounter = new ExpenseCounter();

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

function getAudioFiles(): string[] {
    // Since we're in aidevs3/s02e01, we'll look in the audio subdirectory
    const audioDir = path.join(__dirname, 'audio');
    
    try {
        console.log('audioDir', audioDir);
        // Explicitly typing the files array as string[]
        const files: string[] = fs.readdirSync(audioDir);
        console.log('Files in audio directory:', audioDir);
        return files;
    } catch (error) {
        console.error('Error reading audio directory:', error);
        return [];
    }
}

async function transcriptAudioFile(file: string, buffer: Buffer) {
    try {
        console.log(`Started transcription for ${file}:`);
        const transcription = await openaiService.transcribeGroq(buffer);
        console.log(`Transcription for ${file} finished`);
        return {
            file,
            transcription
        };
    } catch (error) {
        console.error(`Error transcribing ${file}:`, error);
        return {
            file,
            error: 'Transcription failed'
        };
    }
}

async function investigateAddress(prompt: string): Promise<string | null> {
    console.log('Investigating...');

    const model = 'gpt-4o';
    const response = await openaiService.completion({
        messages: [{
            role: 'system',
            content: prompt
        }],
        jsonMode: true,
        model
    }) as OpenAI.Chat.Completions.ChatCompletion;

    expenseCounter.increaseCost(response);

    return response.choices[0].message.content;
}

const prompt = `
    Otrzymujesz listę transkrypcji wywiadów z osobami, które znają Andrzeja Maja.
    Nie używaj żadnych innych informacji o Andrzeju Maju niż te zawarte w transkrypcjach.
    Twoim zadaniem jest znalezienie ulicy instytutu uczelni, gdzie wykłada Andrzej Maj.
    Możesz korzystać z własnej wiedzy do szukania informacji o uczelniach i instytutach w Polsce.
    Kolejne kroki rozumowania umieść w polu "thinking" JSONa.
    
    Odpowiedź przedstaw jako JSON o następującej strukturze:
    
    {
        "thinking": "<kolejne kroki rozumowania>",
        "answer": "<ulica instytutu uczelni, gdzie wykłada Andrzej Maj>"
    }
    
    W polu "answer" podaj tylko nazwę ulicy, bez dodatkowych informacji.    

    Zwróć tylko JSONa, bez dodatkowych informacji.
        
    Transkrypcje:
    {{transcriptions}}
`

async function prepareTranscriptions(useCache: boolean = false) {
    if (useCache) {
        return cachedTranscriptions;
    }

    // Read files and create buffers
    return await Promise.all(getAudioFiles().map(async (file: string) => {
        const filePath = path.join(__dirname, 'audio', file);
        const buffer = fs.readFileSync(filePath);
        
        return await transcriptAudioFile(file, buffer);
    }));
}

interface InvestigationAnswer {
    thinking: string;
    answer: string;
}

async function main() {
    const transcriptions = await prepareTranscriptions();
    console.log('All transcriptions:', transcriptions);


    const promptWithTranscriptions = prompt.replace('{{transcriptions}}', transcriptions.map(t => t.transcription).join('\n'));

    const investigationResponse = await investigateAddress(promptWithTranscriptions) ?? '{}';
    console.log('Investigation response:', investigationResponse);
    

    const answer: InvestigationAnswer = JSON.parse(investigationResponse);
    console.log('Answer:', answer);


    const street = answer.answer;

    const headquartersResponse = await headquartersService.report('mp3', street);
    console.log(headquartersResponse);
    
    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();
