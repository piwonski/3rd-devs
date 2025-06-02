import { HeadquartersService } from "../shared/HeadquartersService";
import { RequestService } from "../shared/RequestService";
import { OpenAIService } from "../shared/OpenAIService";
import { ExpenseCounter } from "../shared/ExpenseCounter";
import { CacheService } from "../shared/CacheService";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import type OpenAI from "openai";
import * as path from 'path';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const openAIService = new OpenAIService();
const expenseCounter = new ExpenseCounter();
const cacheService = new CacheService(path.join(__dirname, 'cache'));

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

async function generateBarbaraDescription(photos: PhotoInfo[]): Promise<string> {
    const contentParts: ChatCompletionContentPart[] = [
        ...photos.map(photo => ({
            type: "image_url" as const,
            image_url: { url: photo.url }
        })),
        { type: "text" as const, text: "Stwórz szczegółowy rysopis osoby ze zdjęć." }
    ];

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `Jesteś ekspertem w tworzeniu rysopisów. Twoim zadaniem jest stworzenie szczegółowego rysopisu osoby na podstawie dostarczonych zdjęć.
            
            Rysopis powinien zawierać:
            - Wygląd zewnętrzny (twarz, włosy, oczy, wzrost, budowa ciała)
            - Charakterystyczne cechy wyglądu
            - Przybliżony wiek
            - Ewentualne znaki szczególne
            - Styl ubierania się
            
            Rysopis powinien być napisany w języku polskim, w sposób profesjonalny i szczegółowy.
            Używaj konkretnych określeń i unikaj ogólników.
            Jeśli na zdjęciach widać jakieś charakterystyczne elementy ubioru lub dodatki, uwzględnij je w rysopisie.`
        },
        {
            role: "user",
            content: contentParts
        }
    ];

    const response = await openAIService.completion({
        messages,
        model: "gpt-4.1",
        stream: false,
        jsonMode: false
    }) as OpenAI.Chat.Completions.ChatCompletion;
    expenseCounter.increaseCost(response);

    if ('choices' in response) {
        return response.choices[0].message.content?.trim() || "Nie udało się wygenerować rysopisu.";
    }
    throw new Error('Unexpected response type from OpenAI');
}

async function isSuitablePortraitPhoto(photo: PhotoInfo): Promise<boolean> {
    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `Jesteś ekspertem w analizie zdjęć portretowych. Twoim zadaniem jest określenie, czy zdjęcie nadaje się do celów identyfikacyjnych.
            
            Odpowiedz TAK lub NIE.
            
            Kryteria dla odpowiedzi TAK:
            - Zdjęcie zawiera osobę
            - Osoba jest widoczna na zdjęciu
            - Zdjęcie jest wystarczająco dobrej jakości
            - Twarz jest widoczna (nawet jeśli nie idealnie)
            
            Kryteria dla odpowiedzi NIE:
            - Zdjęcie nie zawiera osoby
            - Zdjęcie jest całkowicie nieczytelne
            - Twarz jest całkowicie zasłonięta
            - Zdjęcie jest zbyt uszkodzone
            `
        },
        {
            role: "user",
            content: [
                { type: "image_url" as const, image_url: { url: photo.url } },
                { type: "text" as const, text: "Czy to zdjęcie nadaje się do celów identyfikacyjnych? Odpowiedz tylko TAK lub NIE." }
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
        const answer = response.choices[0].message.content?.trim().toUpperCase() || "NIE";
        return answer === "TAK";
    }
    throw new Error('Unexpected response type from OpenAI');
}

async function main() {
    try {
        // Ensure cache directory exists
        await cacheService.ensureCacheDirectory();
        
        // Use getOrFetch to either get cached photos or process new ones
        const processedPhotosData = await cacheService.getOrFetch('processed_photos.json', async () => {
            console.log('No cache found, processing new photos...');
            
            const response = await headquartersService.report('photos', 'START');
            console.log('Initial response:', response);
            
            if (!response.message) {
                throw new Error('No message in response');
            }

            const photos = await parsePhotoData(response.message);
            if (!photos || !Array.isArray(photos)) {
                throw new Error('No photos found in response');
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

            return JSON.stringify(processedPhotos, null, 2);
        });

        const processedPhotos: PhotoInfo[] = JSON.parse(processedPhotosData);
        console.log(`Found ${processedPhotos.length} photos (from cache or newly processed)`);
        
        // Use getOrFetch to either get cached suitable portraits or filter them
        const suitablePortraitsData = await cacheService.getOrFetch('suitable_portraits.json', async () => {
            console.log('\nFiltering photos for suitable portraits...');
            const suitablePortraits: PhotoInfo[] = [];
            
            for (const photo of processedPhotos) {
                const isSuitable = await isSuitablePortraitPhoto(photo);
                if (isSuitable) {
                    suitablePortraits.push(photo);
                    console.log(`Photo ${photo.filename} is a suitable portrait`);
                } else {
                    console.log(`Photo ${photo.filename} is not a suitable portrait`);
                }
            }

            if (suitablePortraits.length === 0) {
                console.log('No suitable portrait photos found, using all processed photos');
                return JSON.stringify(processedPhotos, null, 2);
            }

            console.log(`\nFound ${suitablePortraits.length} suitable portrait photos`);
            return JSON.stringify(suitablePortraits, null, 2);
        });

        const suitablePortraits: PhotoInfo[] = JSON.parse(suitablePortraitsData);

        // Generate Barbara's description
        console.log('\nGenerating Barbara\'s description...');
        const description = await generateBarbaraDescription(suitablePortraits);
        console.log('\nBarbara\'s description:');
        console.log(description);

        // Send the description to headquarters
        const reportResponse = await headquartersService.report('photos', description);
        console.log('\nHeadquarters response:', reportResponse);

        // Log API usage summary
        console.log("\nUsed tokens:", expenseCounter.getUsedTokens());
        
    } catch (error) {
        console.error('Error:', error);
        // Log API usage even if there's an error
        console.log("\nUsed tokens:", expenseCounter.getUsedTokens());
    }
}

await main();