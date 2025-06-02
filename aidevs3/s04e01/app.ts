import { HeadquartersService } from "../shared/HeadquartersService";
import { RequestService } from "../shared/RequestService";
import { OpenAIService } from "../shared/OpenAIService";
import { ExpenseCounter } from "../shared/ExpenseCounter";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type OpenAI from "openai";

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const openAIService = new OpenAIService();
const expenseCounter = new ExpenseCounter();

interface PhotoInfo {
    url: string;
    filename: string;
}

async function parsePhotoData(message: string, previousUrl?: string): Promise<PhotoInfo[] | PhotoInfo | null> {
    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `You are a photo information parser. Your task is to extract photo information from a message.
            
            The message may contain:
            1. Multiple photos with their URLs and filenames
            2. A single photo with its URL and filename
            3. Just a filename that needs to be combined with a base URL
            
            ${previousUrl ? `Previous photo URL: ${previousUrl}` : ''}
            
            Extract the information and return it in JSON format.
            For multiple photos, use this structure:
            {
                "photos": [
                    {
                        "url": "full URL to the photo",
                        "filename": "filename of the photo"
                    }
                ]
            }
            
            For a single photo, use this structure:
            {
                "url": "full URL to the photo",
                "filename": "filename of the photo"
            }
            
            Rules for URL construction:
            - If the message contains a full URL, use it as is
            - If the message contains only a filename and a previous URL is provided, construct the URL by combining the base URL from the previous URL with the new filename
            - The base URL is everything up to and including the last '/' in the previous URL
            
            If you can't find any photo information in the message, return null.
            Make sure all URLs are complete and valid.`
        },
        {
            role: "user",
            content: message
        }
    ];

    const response = await openAIService.completion({
        messages,
        model: "gpt-4.1-mini",
        stream: false,
        jsonMode: true
    }) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(response);

    if ('choices' in response) {
        try {
            const result = JSON.parse(response.choices[0].message.content || 'null');
            if (!result) return null;

            // If we got an array of photos, return it
            if (result.photos) {
                return result.photos;
            }

            // If we got a single photo, return it
            if (result.url || result.filename) {
                return result;
            }

            return null;
        } catch (error) {
            console.error('Error parsing photo data:', error);
            return null;
        }
    }
    throw new Error('Unexpected response type from OpenAI');
}

async function assessImageQuality(imageUrl: string): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `You are an expert image quality assessor. Analyze the image and determine if it needs any of these operations:
            - REPAIR: if the image has noise, glitches, or artifacts
            - DARKEN: if the image is too bright or overexposed
            - BRIGHTEN: if the image is too dark or underexposed
            - GOOD: if the image is of good quality and doesn't need any adjustments
            - UNUSABLE: if the image is too damaged or not of Barbara
            
            Respond with exactly one of these words: REPAIR, DARKEN, BRIGHTEN, GOOD, or UNUSABLE`
        },
        {
            role: "user",
            content: [
                { type: "image_url", image_url: { url: imageUrl } },
                { type: "text", text: "What operation does this image need?" }
            ]
        }
    ];

    const response = await openAIService.completion({
        messages,
        model: "gpt-4.1-mini",
        stream: false,
        jsonMode: false
    }) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(response);

    if ('choices' in response) {
        return response.choices[0].message.content?.trim() || "UNUSABLE";
    }
    throw new Error('Unexpected response type from OpenAI');
}

async function processPhoto(photo: PhotoInfo): Promise<PhotoInfo | null> {
    console.log(`Processing photo: ${photo.filename}`);
    
    let currentPhoto = { ...photo };
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        const qualityAssessment = await assessImageQuality(currentPhoto.url);
        
        console.log(`Quality assessment for ${currentPhoto.filename}: ${qualityAssessment}`);
        
        if (qualityAssessment === "GOOD") {
            console.log(`Photo ${currentPhoto.filename} is of good quality`);
            return currentPhoto;
        }
        
        if (qualityAssessment === "UNUSABLE") {
            console.log(`Photo ${currentPhoto.filename} is unusable`);
            return null;
        }
        
        const command = `${qualityAssessment} ${currentPhoto.filename}`;
        console.log(`Sending command: ${command}`);
        
        const response = await headquartersService.report('photos', command);
        console.log(`Response: ${JSON.stringify(response)}`);
        
        if (!response.message) {
            console.log('No message in response, stopping processing');
            return null;
        }

        const newPhotoInfo = await parsePhotoData(response.message, currentPhoto.url);
        if (newPhotoInfo && !Array.isArray(newPhotoInfo)) {
            currentPhoto = newPhotoInfo;
        } else {
            console.log('Could not extract new photo information from response, stopping processing');
            return null;
        }
        
        attempts++;
    }
    
    console.log(`Reached maximum attempts for ${currentPhoto.filename}`);
    return null;
}

async function main() {
    try {
        const response = await headquartersService.report('photos', 'START');
        console.log('Initial response:', response);
        
        if (!response.message) {
            console.error('No message in response');
            return;
        }

        const photos = await parsePhotoData(response.message);
        if (!photos || !Array.isArray(photos)) {
            console.error('No photos found in response');
            return;
        }

        console.log(`Found ${photos.length} photos to process`);
        
        // Process each photo and collect results
        const processedPhotos: PhotoInfo[] = [];
        for (const photo of photos) {
            const finalPhoto = await processPhoto(photo);
            if (finalPhoto) {
                processedPhotos.push(finalPhoto);
            }
        }
        
        console.log('Successfully processed photos:', processedPhotos.map(p => ({
            filename: p.filename,
            url: p.url
        })));

        // Log API usage summary
        console.log("Used tokens:", expenseCounter.getUsedTokens());
        
    } catch (error) {
        console.error('Error:', error);
        // Log API usage even if there's an error
        console.log("Used tokens:", expenseCounter.getUsedTokens());
    }
}

await main();