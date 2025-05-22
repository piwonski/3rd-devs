import fs from "fs";
import path from "path";
import {HeadquartersService} from "../shared/HeadquartersService.ts";
import {RequestService} from "../shared/RequestService.ts";
import { OpenAIService } from "../shared/OpenAIService.ts";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const inputDirectoryName = 'input-files';

interface FactoryAnswer {
    people: string[];
    hardware: string[];
}

const prompt = `
    You are report analyst.
    You are given a report from the factory.
    You need to analyze the report and assign the report to one of the following categories:
    - people
    - hardware
    - other
    People category is assigned to reports that contain information about catched or identified people.
    Hardware category is assigned to reports that contain information about fixed or repaired hardware.
    Other category is assigned to reports that contain information about other things.
    You need to return the report in the following JSON format:
    {
        "thinking": "<your thinking process here>",
        "answer": "<your answer here>"
    }
    Make sure to return valid JSON with exactly these two fields.
`;

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const openaiService = new OpenAIService();

function prepareFactoryAnswer(): FactoryAnswer {
    return {
        people: [],
        hardware: [],
    }
}

function restoreOriginalFileName(fileName: string): string {
    // Remove _transcription or _description suffix and restore original extension
    if (fileName.endsWith('_transcription.txt')) {
        return fileName.replace('_transcription.txt', '.mp3');
    }
    if (fileName.endsWith('_description.txt')) {
        return fileName.replace('_description.txt', '.png');
    }
    if (fileName.endsWith('_text.txt')) {
        return fileName.replace('_text.txt', '.txt');
    }
    return fileName;
}

async function processImages(imagePaths: string[], prompt: string): Promise<{ description: string; source: string }[]> {
  try {
    const results = await Promise.all(imagePaths.map(path => openaiService.processImage(path, prompt)));
    return results;
  } catch (error) {
    console.error("Error processing multiple images:", error);
    throw error;
  }
}

async function processAudioFiles(audioPaths: string[]): Promise<{ transcription: string; source: string }[]> {
  try {
    const results = await Promise.all(audioPaths.map(async (filePath) => {
      const audioBuffer = await fs.promises.readFile(filePath);
      const transcription = await openaiService.transcribeGroq(audioBuffer);
      return {
        transcription,
        source: filePath
      };
    }));
    return results;
  } catch (error) {
    console.error("Error processing audio files:", error);
    throw error;
  }
}

async function main() {
    const reportFiles = fs.readdirSync(path.join(__dirname, inputDirectoryName))
        .map(file => path.join(__dirname, inputDirectoryName, file));

    const textFiles = reportFiles.filter(file => file.endsWith('.txt'));
    const imageFiles = reportFiles.filter(file => file.endsWith('.png'));
    const audioFiles = reportFiles.filter(file => file.endsWith('.mp3'));

    function hasOutputAlreadyGenerated(extension: string, outputSuffix: string) {
        return (file: string) => {
            const outputPath = path.join(__dirname, 'output-files', `${path.basename(file, extension)}${outputSuffix}.txt`);
            return !fs.existsSync(outputPath);
        };
    }

    // Process image files and store descriptions
    const imagePrompt = `
        You are a helpful assistant that reads text from the image.
        You need to return only the text from the image, do not add any other text.
    `;
    const imageDescriptions = await processImages(
        imageFiles.filter(hasOutputAlreadyGenerated('.png', '_description')),
        imagePrompt
    );

    console.log('Image descriptions:', imageDescriptions);
    
    // Process audio files
    const audioTranscriptions = await processAudioFiles(
        audioFiles.filter(hasOutputAlreadyGenerated('.mp3', '_transcription'))
    );
    console.log('Audio transcriptions:', audioTranscriptions);
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'output-files');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // Save each image description to a separate file
    for (const result of imageDescriptions) {
        const fileName = path.basename(result.source, '.png');
        const outputPath = path.join(outputDir, `${fileName}_description.txt`);
        fs.writeFileSync(outputPath, result.description);
        console.log(`Saved description for ${fileName} to ${outputPath}`);
    }

    // Save each audio transcription to a separate file
    for (const result of audioTranscriptions) {
        const fileName = path.basename(result.source, '.mp3');
        const outputPath = path.join(outputDir, `${fileName}_transcription.txt`);
        fs.writeFileSync(outputPath, result.transcription);
        console.log(`Saved transcription for ${fileName} to ${outputPath}`);
    }

    // Copy text files to output directory with suffix
    for (const textFile of textFiles.filter(hasOutputAlreadyGenerated('.txt', '_text'))) {
        const fileName = path.basename(textFile, '.txt');
        const outputPath = path.join(outputDir, `${fileName}_text.txt`);
        const content = fs.readFileSync(textFile, 'utf-8');
        fs.writeFileSync(outputPath, content);
        console.log(`Saved text for ${fileName} to ${outputPath}`);
    }

    const answer: FactoryAnswer = prepareFactoryAnswer();

    // Read and analyze all files from output directory
    const outputFiles = fs.readdirSync(outputDir);
    const analysisResults = await Promise.all(
        outputFiles.map(async (file) => {
            try {
                const filePath = path.join(outputDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const messages: ChatCompletionMessageParam[] = [
                    { role: "system", content: prompt },
                    { role: "user", content: content }
                ];
                const completion = await openaiService.completion({
                    messages,
                    model: "gpt-4o",
                    jsonMode: true
                });
                if ('choices' in completion && completion.choices[0].message.content) {
                    const analysis = JSON.parse(completion.choices[0].message.content);
                    return {
                        fileName: file,
                        analysis: analysis
                    };
                }
                throw new Error('Unexpected completion response format or empty content');
            } catch (error) {
                console.error(`Error processing file ${file}:`, error);
                return {
                    fileName: file,
                    analysis: { thinking: "Error processing file", answer: "other" }
                };
            }
        })
    );

    console.log('Analysis results:', analysisResults);

    // Categorize files based on analysis
    for (const result of analysisResults) {
        const category = result.analysis.answer.toLowerCase();
        const originalFileName = restoreOriginalFileName(result.fileName);
        if (category === 'people') {
            answer.people.push(originalFileName);
        } else if (category === 'hardware') {
            answer.hardware.push(originalFileName);
        }
        // Skip 'other' category as per requirements
    }

    console.log('Answer:', answer);

    const headquartersResponse = await headquartersService.report('kategorie', answer);
    console.log('Headquarters response:', headquartersResponse);
}

await main();