import { OpenAIService } from "../../audio/OpenAIService";
import * as fs from 'fs';
import * as path from 'path';

const openaiService = new OpenAIService();

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
        const transcription = await openaiService.transcribeGroq(buffer);
        console.log(`Transcription for ${file}:`, transcription);
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
async function main() {
    // Read files and create buffers
    const transcriptions = await Promise.all(getAudioFiles().map(async (file: string) => {
        const filePath = path.join(__dirname, 'audio', file);
        const buffer = fs.readFileSync(filePath);
        
        return await transcriptAudioFile(file, buffer);
    }));

    console.log('All transcriptions:', transcriptions);

}

await main();