import { Environment } from '../shared/Environment';
import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { HtmlToMarkdownConverter } from '../shared/HtmlToMarkdownConverter';
import { OpenAIService } from '../shared/OpenAIService';
import fetch from 'node-fetch';
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const htmlToMarkdownConverter = new HtmlToMarkdownConverter();
const openAIService = new OpenAIService();

// Type definition for Image
type Image = {
    alt: string;
    url: string;
    context: string; // context of the image in the article
    description: string; // description of the image in the article, it's preview + context
    preview: string; // visual description of the image itself, without surrounding context, provided by the user
    base64: string;
    name: string;
};

// Type definition for Audio
type Audio = {
    alt: string;
    url: string;
    base64: string;
    name: string;
    transcription: string; // transcription of the audio content
};

async function extractImages(markdown: string): Promise<Image[]> {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];

    const imagePromises = matches.map(async ([, alt, url]) => {
        try {
            const name = url.split('/').pop() || '';
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            return {
                alt,
                url,
                context: '',
                description: '',
                preview: '',
                base64,
                name
            };
        } catch (error) {
            console.error(`Error processing image ${url}:`, error);
            return null;
        }
    });

    const results = await Promise.all(imagePromises);
    return results.filter((link): link is Image => link !== null);
}

async function extractAudio(markdown: string): Promise<Audio[]> {
    const audioRegex = /\[([^\]]*)\]\(([^)]+\.(mp3|wav|ogg|m4a))\)/g;
    const matches = [...markdown.matchAll(audioRegex)];

    const audioPromises = matches.map(async ([, alt, url]) => {
        try {
            const name = url.split('/').pop() || '';
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            return {
                alt,
                url,
                base64,
                name,
                transcription: ''
            };
        } catch (error) {
            console.error(`Error processing audio ${url}:`, error);
            return null;
        }
    });

    const results = await Promise.all(audioPromises);
    return results.filter((audio): audio is Audio => audio !== null);
}

async function getImageContexts(article: string, images: Image[]): Promise<{ images: Array<{ name: string, context: string, preview: string }> }> {
    const userMessage: ChatCompletionMessageParam = {
        role: 'user',
        content: article
    };

    const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: `Analyze the article and provide context for each image. For each image, explain how it relates to the surrounding text and what information it adds to the article. Return the result in JSON format with an 'images' array containing objects with 'name', 'context', and 'preview' properties.`
    };

    const contextResponse = await openAIService.completion({
        messages: [systemMessage, userMessage],
        model: 'gpt-4o',
        jsonMode: true
    });

    console.log('Context response:', contextResponse);
    
    if ('choices' in contextResponse) {
        const contextResult = JSON.parse(contextResponse.choices[0].message.content || '{}');

        // Generate previews for all images simultaneously
        const previewPromises = images.map(async (image) => {
            const prompt = `Describe the image ${image.name} concisely. Focus on the main elements and overall composition. Return the result in JSON format with only 'name' and 'preview' properties.`;
            return await openAIService.processImageWithPrompt(image.base64, prompt, image.name);
        });
        const previews = await Promise.all(previewPromises);
        console.log('Previews:', previews);

        // Merge context and preview information
        const mergedResults = contextResult.images.map((contextImage: { name: string, context: string }) => {
            const preview = previews.find(p => p.name === contextImage.name);
            return {
                ...contextImage,
                preview: preview ? preview.preview : ''
            };
        });

        console.log('Merged results:', mergedResults);

        return { images: mergedResults };
    }
    throw new Error('Unexpected response type from OpenAI');
}

async function transcribeAudio(audio: Audio): Promise<Audio> {
    try {
        const transcription = await openAIService.transcribeGroq(
            Buffer.from(audio.base64, 'base64')
        );
        return { ...audio, transcription };
    } catch (error) {
        console.error(`Error transcribing audio ${audio.name}:`, error);
        return { ...audio, transcription: 'Transcription failed' };
    }
}

async function refineDescription(image: Image): Promise<Image> {
    const userMessage: ChatCompletionMessageParam = {
        role: 'user',
        content: [
            {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${image.base64}` }
            },
            {
                type: "text",
                text: `Write a description of the image ${image.name}. I have some <context>${image.context}</context> that should be useful for understanding the image in a better way. An initial preview of the image is: <preview>${image.preview}</preview>. A good description briefly describes what is on the image, and uses the context to make it more relevant to the article. The purpose of this description is for summarizing the article, so we need just an essence of the image considering the context, not a detailed description of what is on the image.`
            }
        ]
    };

    const response = await openAIService.completion({
        messages: [userMessage],
        model: 'gpt-4o'
    });
    
    if ('choices' in response) {
        return { ...image, description: response.choices[0].message.content || '' };
    }
    throw new Error('Unexpected response type from OpenAI');
}

async function processAndEnhanceMarkdown(markdown: string, cacheDir: string): Promise<string> {
    // Create directories if they don't exist
    const imagesDir = path.join(cacheDir, 'images');
    const audioDir = path.join(cacheDir, 'audio');
    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });

    // Extract and process images
    const images = await extractImages(markdown);
    console.log('Number of images found:', images.length);

    // Extract and process audio files
    const audioFiles = await extractAudio(markdown);
    console.log('Number of audio files found:', audioFiles.length);

    // Get context for all images
    const contexts = await getImageContexts(markdown, images);
    console.log('Number of image metadata found:', contexts.images.length);

    // Process each image with context and preview
    const processedImages = await Promise.all(images.map(async (image) => {
        const { context = '', preview = '' } = contexts.images.find(ctx => ctx.name === image.name) || {};
        return await refineDescription({ ...image, preview, context });
    }));

    // Process each audio file with transcription
    const processedAudio = await Promise.all(audioFiles.map(async (audio) => {
        return await transcribeAudio(audio);
    }));

    // Save images to disk
    for (const image of processedImages) {
        const imagePath = path.join(imagesDir, image.name);
        await fs.writeFile(imagePath, Buffer.from(image.base64, 'base64'));
    }

    // Save audio files to disk
    for (const audio of processedAudio) {
        const audioPath = path.join(audioDir, audio.name);
        await fs.writeFile(audioPath, Buffer.from(audio.base64, 'base64'));
    }

    // Enhance markdown with image descriptions
    let enhancedMarkdown = markdown;
    for (const image of processedImages) {
        const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${image.url}\\)`, 'g');
        const enhancedImage = `![${image.alt}](images/${image.name})\n\n*Image Description: ${image.description}*`;
        enhancedMarkdown = enhancedMarkdown.replace(imagePattern, enhancedImage);
    }

    // Enhance markdown with audio transcriptions
    for (const audio of processedAudio) {
        const audioPattern = new RegExp(`\\[([^\\]]*)\\]\\(${audio.url}\\)`, 'g');
        const enhancedAudio = `[${audio.alt}](audio/${audio.name})\n\n*Transcription: ${audio.transcription}*`;
        enhancedMarkdown = enhancedMarkdown.replace(audioPattern, enhancedAudio);
    }

    return enhancedMarkdown;
}

const questionPrompt = `
You are a helpful assistant that can answer questions about the article.
You are given an article and few, numbered questions.
You need to answer the questions based on the article.
Take into account the images' descriptions and audio files' transcriptions given in the article.
Be concise and to the point.
Use specific names instead of generic ones.

Article:
{article}

Questions:
{questions}

Answer the questions in the following JSON format:
{
    "01": "answer to question 01",
    "02": "answer to question 02",
    "03": "answer to question 03",
    ...
}
Do not include any other text in your response.
`;

async function main() {
    // Create cache directory if it doesn't exist
    const cacheDir = path.join(__dirname, 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    
    
    let markdown = '';
    if (!fsSync.existsSync(path.join(cacheDir, 'article.md'))) {
        // Fetch the article
        const article = await headquartersService.getArxivHtml();
        console.log('Article fetched');

        // Convert HTML to Markdown
        console.log('Converting HTML to Markdown...');
        markdown = await htmlToMarkdownConverter.convert(article);
    } else {
        console.log('Loading article from cache...');
        markdown = await fs.readFile(path.join(cacheDir, 'article.md'), 'utf-8');
    }

    let enhancedMarkdown = '';
    if (!fsSync.existsSync(path.join(cacheDir, 'enhanced-article.md'))) {
        // Process images and enhance markdown with descriptions
        console.log('Processing images...');
        enhancedMarkdown = await processAndEnhanceMarkdown(markdown, cacheDir);
            
        // Save to file
        const outputPath = path.join(cacheDir, 'enhanced-article.md');
        await fs.writeFile(outputPath, enhancedMarkdown, 'utf-8');
        console.log('Article saved to:', outputPath);
    } else {
        console.log('Loading enhanced article from cache...');
        enhancedMarkdown = await fs.readFile(path.join(cacheDir, 'enhanced-article.md'), 'utf-8');
    }
    
    // Fetch the questions
    const questions = await headquartersService.getArxivQuestions();
    console.log('Questions:', questions);


    const answerResponse = await openAIService.completion({
        messages: [
            { role: 'user', content: questionPrompt.replace('{article}', enhancedMarkdown).replace('{questions}', questions) }
        ],
        model: 'gpt-4o',
        jsonMode: true
    });

    if (!('choices' in answerResponse)) {
        console.error('Unexpected response format from OpenAI: ', answerResponse);
        return;
    }
    const answer = answerResponse.choices[0].message.content ?? '';
    console.log('Answer:', answer);
    const headquartersResponse = await headquartersService.report('arxiv', JSON.parse(answer));
    console.log('Headquarters answer:', headquartersResponse);
}

await main();