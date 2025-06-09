import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { OpenAIService } from '../shared/OpenAIService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { HeadquartersResponse } from '../shared/sharedTypes';

// Use require for pdf-parse-debugging-disabled to avoid type issues
const pdfParse = require('pdf-parse-debugging-disabled');
const execAsync = promisify(exec);

interface Question {
    id: string;
    text: string;
}

interface Feedback {
    headquartersHint: string;
    incorrectValue: string;
    transformedHint: string;
}

interface Answer {
    questionId: string;
    message: string;
}

interface QuestionWithContext extends Question {
    feedbacks: Feedback[];
}

class PdfProcessor {
    private openaiService: OpenAIService;
    private cacheService: CacheService;

    constructor(openaiService: OpenAIService, cacheService: CacheService) {
        this.openaiService = openaiService;
        this.cacheService = cacheService;
    }

    async extractTextFromPdf(pdfPath: string): Promise<{ pages1to18: string, page19Text: string, page19ImagePath: string, page19ImageBase64: string }> {
        // Extract text from pages 1-18
        console.log('📄 Extracting text from pages 1-18...');
        const pages1to18Text = await this.cacheService.getOrFetch('pdf-text-pages-1-18.txt', async () => {
            const dataBuffer = fs.readFileSync(pdfPath);
            const data = await pdfParse(dataBuffer);
            return data.text;
        });

        // Extract page 19 image (optimized for LLM usage)
        console.log('🖼️ Extracting page 19 image...');
        const page19ImagePath = await this.extractPage19Image(pdfPath);
        
        // Get base64 version for LLM usage
        const page19ImageBase64 = await this.cacheService.getOrFetch('pdf-page-19-base64.txt', async () => {
            const imageBuffer = fs.readFileSync(page19ImagePath);
            return imageBuffer.toString('base64');
        });

        // Process page 19 with OCR
        console.log('🔍 Processing page 19 with OCR...');
        const page19Text = await this.cacheService.getOrFetch('pdf-page-19-ocr.txt', async () => {
            try {
                console.log('👁️ Using AI vision to extract text from page 19...');
                console.log(`📏 Base64 image size: ${page19ImageBase64.length} characters`);

                const notebookPrompt = `
                <NOTATNIK RAFAŁA>
                ${pages1to18Text}
                </NOTATNIK RAFAŁA>
                `;
                
                const prompt = `Jesteś ekspertem OCR. Przeanalizuj ten obraz, który zawiera odręczne notatki w języku polskim. 
                Obraz zawiera kilka notatek, które są zapisane w różnych miejscach.
                Spróbuj skleić notatki w jedną całość, zanim wyekstrahujesz tekst.
                W szczególności skup się na nazwach miejsc, które są zapisane w notatkach.
                Część odręcznej nazwy znajduje się na jednej części obrazu, a część na drugiej. 
                Spróbuj skleić te części w jedną całość.
                
                Weź pod uwagę, że obraz jest częścią notatnika Rafała.

                Znajdź wszystkie nazwy miejsc w notatniku Rafała, te nazwy mogą też znajdować się w obrazie.
                Jeśli notatka wspomina o mieście, które znajduje się obok innego miasta, sprawdź, które miasta faktycznie znajdują się w okolicy i dopasuj tę nazwę do napisu z notatki.
                
                Wyekstrahuj cały tekst z tego obrazu jak najdokładniej.
                Zwróć odpowiedź w formacie JSON z polem "preview" zawierającym wyekstrahowany tekst.
                W polu 'thinking' zwróć swoje myśli i rozumowanie.`;

                console.log('🤖 Calling OpenAI Vision API...');

                const result = await this.openaiService.completion({
                    messages: [
                        { role: "system", content: notebookPrompt },
                        { 
                            role: "user", 
                            content: [
                                { type: "text", text: prompt },
                                { type: "image_url", image_url: { url: `data:image/png;base64,${page19ImageBase64}` } }
                            ]
                        }
                    ],
                    model: "gpt-4.1",
                    jsonMode: true
                });

                console.log('✅ OpenAI Vision API completed');
                
                const content = (result as any).choices[0].message.content;
                const jsonMatch = content.match(/\{.*"preview".*\}/s);
                const json = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
                console.log('💡 Myśli:', json.thinking);
                return json.preview;
            } catch (error) {
                console.error('❌ Error during page 19 OCR processing:', error);
                throw error;
            }
        });

        return {
            pages1to18: pages1to18Text,
            page19Text: page19Text,
            page19ImagePath: page19ImagePath,
            page19ImageBase64: page19ImageBase64
        };
    }

    private async extractPage19Image(pdfPath: string): Promise<string> {
        const imagePath = path.join(path.dirname(pdfPath), 'page19-optimized.png');
        
        // Check if image already exists in cache
        if (fs.existsSync(imagePath)) {
            console.log('📦 Using cached page 19 image');
            return imagePath;
        }

        console.log('🔄 Converting PDF page 19 to optimized image...');
        
        // Try multiple methods for PDF to image conversion
        const methods = [
            {
                name: 'pdftoppm',
                command: `pdftoppm -png -f 19 -l 19 -r 300 "${pdfPath}" "${imagePath.replace('.png', '')}"`,
                postProcess: async () => {
                    // pdftoppm creates files with suffix, rename to our expected name
                    const generatedFile = imagePath.replace('.png', '-19.png');
                    if (fs.existsSync(generatedFile)) {
                        fs.renameSync(generatedFile, imagePath);
                    }
                }
            },
            {
                name: 'ImageMagick with policy bypass',
                command: `magick -density 300 "${pdfPath}[18]" -background white -alpha remove -resize 1536x1536> -quality 90 "${imagePath}"`,
                postProcess: async () => {}
            },
            {
                name: 'ImageMagick standard',
                command: `convert -density 300 "${pdfPath}[18]" -background white -alpha remove -resize 1536x1536> -quality 90 "${imagePath}"`,
                postProcess: async () => {}
            }
        ];

        for (const method of methods) {
            try {
                console.log(`📝 Trying ${method.name}...`);
                console.log(`📝 Command: ${method.command}`);
                
                await execAsync(method.command);
                await method.postProcess();
                
                if (fs.existsSync(imagePath)) {
                    console.log(`✅ PDF page converted successfully using ${method.name}`);
                    return imagePath;
                }
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.log(`⚠️ ${method.name} failed: ${errorMessage}`);
                continue;
            }
        }
        
        throw new Error('All PDF conversion methods failed. Please install pdftoppm (poppler-utils) or configure ImageMagick with PDF support.');
    }
}

class App {
    private requestService: RequestService;
    private headquartersService: HeadquartersService;
    private cacheService: CacheService;
    private openaiService: OpenAIService;
    private expenseCounter: ExpenseCounter;
    private pdfProcessor: PdfProcessor;
    private cacheDir: string;
    private page19ImageBase64: string | null = null;

    constructor() {
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheDir = path.join(__dirname, 'cache');
        this.cacheService = new CacheService(this.cacheDir);
        this.expenseCounter = new ExpenseCounter();
        this.openaiService = new OpenAIService(3072, this.expenseCounter);
        this.pdfProcessor = new PdfProcessor(this.openaiService, this.cacheService);
        this.cacheService.ensureCacheDirectory();
    }

    async run() {
        try {
            console.log('🚀 Starting data download and processing...\n');
            console.log('💰 Expense tracking initialized\n');

            // Ensure cache directory exists
            await this.cacheService.ensureCacheDirectory();

            // Download or get from cache Rafał's notebook (PDF)
            const pdfPath = await this.downloadOrGetRafalsNotebook();

            // Process PDF content
            console.log('\n🔍 Processing PDF content...');
            const pdfContent = await this.pdfProcessor.extractTextFromPdf(pdfPath);

            // Store page 19 image for later LLM usage
            this.page19ImageBase64 = pdfContent.page19ImageBase64;

            // Save processed content
            const fullContentPath = path.join(this.cacheDir, 'notatnik-full-content.txt');
            const fullContent = `=== STRONY 1-18 (TEKST) ===\n\n${pdfContent.pages1to18}\n\n=== STRONA 19 (OCR) ===\n\n${pdfContent.page19Text}`;
            fs.writeFileSync(fullContentPath, fullContent);
            console.log(`✅ Full PDF content saved to: ${fullContentPath}`);
            console.log(`🖼️ Page 19 image available at: ${pdfContent.page19ImagePath}`);
            console.log(`📏 Page 19 base64 ready for LLM usage (${pdfContent.page19ImageBase64.length} chars)`);

            // Get API key and download or get from cache questions (JSON)
            console.log('\n📋 Getting questions list (JSON)...');
            const apiKey = process.env.CENTRALA_API_KEY;
            if (!apiKey) {
                throw new Error('CENTRALA_API_KEY environment variable is not set');
            }
            
            const questionsUrl = `https://c3ntrala.ag3nts.org/data/${apiKey}/notes.json`;
            const questionsDataString = await this.cacheService.getOrFetch('notes.json', async () => {
                console.log('📥 Fetching questions from API...');
                const data = await this.requestService.get(questionsUrl);
                return JSON.stringify(data, null, 2);
            });
            
            const questionsDataRaw = JSON.parse(questionsDataString);
            const questionsData: QuestionWithContext[] = Object.entries(questionsDataRaw).map(([id, text]) => ({
                id,
                text: text as string,
                feedbacks: []
            }));
            
            // Display final results and costs
            this.displayResults(pdfContent, questionsData);

            // Now answer the questions using AI with iterative feedback
            console.log('\n🤖 Rozpoczynam iteracyjną analizę pytań...');
            const fullNotebookContent = fs.readFileSync(fullContentPath, 'utf-8');
            
            // Wczytaj poprawne odpowiedzi z poprzednich uruchomień
            const correctAnswersPath = path.join(this.cacheDir, 'correct-answers.json');
            let correctAnswers: Answer[] = [];
            
            if (fs.existsSync(correctAnswersPath)) {
                try {
                    correctAnswers = JSON.parse(fs.readFileSync(correctAnswersPath, 'utf-8'));
                    console.log('📦 Wczytano poprawne odpowiedzi z cache\'u:');
                    correctAnswers.forEach(answer => {
                        console.log(`  ${answer.questionId}: ${answer.message}`);
                    });
                } catch (error) {
                    console.log('⚠️ Błąd wczytywania cache\'u odpowiedzi, zaczynam od nowa');
                }
            } else {
                console.log('📝 Brak cache\'u odpowiedzi - pierwsza sesja');
            }
            
            let answers: Answer[] = [];
            // Feedback jest teraz przechowywany w questionsData
            let finalFlag: string | null = null;
            let analysisResult: { success: boolean; flag: string | null; errorMessage: string } | null = null;
            
            // Określ które pytania trzeba zadać (te które nie są w cache'u)
            const allQuestionIds = questionsData.map(q => q.id);
            const cachedQuestionIds = correctAnswers.map(answer => answer.questionId);
            let questionsToAsk: QuestionWithContext[] = questionsData.filter(q => !cachedQuestionIds.includes(q.id));
            
            if (questionsToAsk.length === 0) {
                console.log('🎉 Wszystkie odpowiedzi są już w cache\'u! Sprawdzam z Centralą...');
            } else {
                console.log(`📝 Pytania do zadania: ${questionsToAsk.map(q => q.id).join(', ')}`);
                console.log(`✅ Pytania z cache'u: ${correctAnswers.map(answer => answer.questionId).join(', ') || 'brak'}`);
            }
            
            const maxIterations = 5;
            
            for (let iteration = 1; iteration <= maxIterations; iteration++) {
                console.log(`\n🔄 === ITERACJA ${iteration}/${maxIterations} ===`);
                
                // Wyświetl informację o pytaniach do zadania
                if (questionsToAsk.length === 0) {
                    console.log('📝 Wszystkie odpowiedzi z cache\'u - sprawdzam z Centralą');
                } else if (questionsToAsk.length === allQuestionIds.length) {
                    console.log('📝 Zadaję wszystkie pytania (brak cache\'u)');
                } else {
                    console.log(`📝 Cache'owanie: zadaję tylko pytania: ${questionsToAsk.map(q => q.id).join(', ')}`);
                }
                
                // Zadaj pytania (tylko te które nie są w cache'u)
                let newAnswers: Answer[] = [];
                if (questionsToAsk.length > 0) {
                    // questionsToAsk już zawiera feedback, więc można bezpośrednio użyć
                    const questionsWithContext: QuestionWithContext[] = questionsToAsk;
                    
                    newAnswers = await this.answerQuestions(fullNotebookContent, questionsWithContext);
                }
                
                // Połącz nowe odpowiedzi z cache'owanymi poprawnymi
                answers = [...correctAnswers, ...newAnswers];
                
                console.log('\n📋 Finalne odpowiedzi z tej iteracji:');
                // Sortuj odpowiedzi po numerze pytania
                const sortedAnswers = answers.sort((a, b) => a.questionId.localeCompare(b.questionId));
                sortedAnswers.forEach(answer => {
                    const isFromCache = correctAnswers.some(cached => cached.questionId === answer.questionId);
                    const source = isFromCache ? '🟢 (cache)' : '🆕 (nowe)';
                    console.log(`${answer.questionId}: ${answer.message} ${source}`);
                });

                // Wyślij wszystkie odpowiedzi do centrali
                console.log('\n📤 Wysyłanie odpowiedzi do Centrali...');
                try {
                    // Konwertuj Answer[] na Record<string, string> dla centrali
                    const answersRecord: Record<string, string> = {};
                    answers.forEach(answer => {
                        answersRecord[answer.questionId] = answer.message;
                    });
                    const result = await this.headquartersService.report('notes', answersRecord);
                    console.log('🎯 Odpowiedź z Centrali:', result);
                    
                    // Analizuj odpowiedź z centrali
                    analysisResult = this.analyzeHeadquartersResponse(result);
                    
                    if (analysisResult.success) {
                        console.log('🎉 SUKCES! Wszystkie odpowiedzi zostały zaakceptowane.');
                        
                        // Zapisz wszystkie odpowiedzi jako poprawne
                        fs.writeFileSync(correctAnswersPath, JSON.stringify(answers, null, 2));
                        console.log(`💾 Zapisano wszystkie poprawne odpowiedzi do: ${correctAnswersPath}`);
                        
                        finalFlag = analysisResult.flag;
                        break;
                    } else {
                        console.log(`❌ Iteracja ${iteration}: Niektóre odpowiedzi wymagają poprawy`);
                        
                        // Przygotuj feedback dla błędnych pytań
                        const feedback = await this.prepareFeedback(result, fullNotebookContent, questionsData);
                        // Określ które pytania są błędne na podstawie odpowiedzi Centrali
                        const incorrectQuestionsWithContext = this.identifyIncorrectQuestions(result, questionsData, feedback);
                        console.log(`🔍 Błędne pytania do poprawienia: ${incorrectQuestionsWithContext.map(q => q.id).join(', ')}`);
                        
                        // Zbuduj nowy cache poprawnych odpowiedzi
                        correctAnswers = [];
                        answers.forEach(answer => {
                            const isIncorrect = incorrectQuestionsWithContext.some(q => q.id === answer.questionId);
                            if (!isIncorrect) {
                                correctAnswers.push(answer);
                                console.log(`✅ Pytanie ${answer.questionId} zostaje w cache'u jako poprawne`);
                            } else {
                                console.log(`❌ Pytanie ${answer.questionId} pominięte (niepoprawne)`);
                            }
                        });
                        
                        // Zapisz aktualne poprawne odpowiedzi do pliku
                        if (correctAnswers.length > 0) {
                            fs.writeFileSync(correctAnswersPath, JSON.stringify(correctAnswers, null, 2));
                            console.log(`💾 Zapisano poprawne odpowiedzi do cache'u (${correctAnswers.length} pytań)`);
                        }
                        
                        // Zaktualizuj questionsData z nowym feedbackiem
                        incorrectQuestionsWithContext.forEach(questionWithNewFeedback => {
                            const questionIndex = questionsData.findIndex(q => q.id === questionWithNewFeedback.id);
                            if (questionIndex !== -1) {
                                questionsData[questionIndex] = questionWithNewFeedback;
                            }
                        });
                        
                        // Przygotuj pytania do zadania w następnej iteracji
                        questionsToAsk = incorrectQuestionsWithContext;
                        
                        if (iteration === maxIterations) {
                            console.log('⚠️ Osiągnięto maksymalną liczbę iteracji. Kończę z ostatnimi odpowiedziami.');
                        }
                    }
                    
                } catch (error) {
                    console.error(`❌ Błąd w iteracji ${iteration}:`, error);
                    // Przypisz błąd techniczny do wszystkich pytań które były zadawane
                    const technicalErrorFeedback: Feedback = {
                        headquartersHint: '',
                        incorrectValue: '',
                        transformedHint: `Iteracja ${iteration}: Błąd techniczny: ${error}. Spróbuj inne podejście.`
                    };
                    
                    questionsToAsk.forEach(question => {
                        const questionIndex = questionsData.findIndex(q => q.id === question.id);
                        if (questionIndex !== -1) {
                            questionsData[questionIndex].feedbacks.push(technicalErrorFeedback);
                        }
                    });
                    
                    if (iteration === maxIterations) {
                        console.log('⚠️ Osiągnięto maksymalną liczbę iteracji z błędami.');
                        break;
                    }
                }
                
                // Automatyczna pauza między iteracjami (bez interakcji)
                if (iteration < maxIterations && !analysisResult?.success) {
                    console.log('\n⏳ Pauza przed następną iteracją...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            console.log('\n📋 Finalne odpowiedzi:');
            answers.forEach(answer => {
                console.log(`${answer.questionId}: ${answer.message}`);
            });

            // Display final cost summary after all operations
            const finalTokens = this.expenseCounter.getUsedTokens();
            const finalCosts = this.expenseCounter.getEstimatedCost('gpt-4.1');
            
            console.log('\n💰 Final Cost Summary:');
            console.log(`Model: ${finalCosts.model}`);
            console.log(`Input tokens: ${finalTokens.input.toLocaleString()}`);
            console.log(`Output tokens: ${finalTokens.output.toLocaleString()}`);
            console.log(`Total tokens: ${finalTokens.total.toLocaleString()}`);
            console.log(`Estimated cost: $${finalCosts.totalCost.toFixed(4)} USD`);
            console.log(`  - Input: $${finalCosts.inputCost.toFixed(4)} USD`);
            console.log(`  - Output: $${finalCosts.outputCost.toFixed(4)} USD`);

            // Display final flag prominently
            if (finalFlag) {
                console.log('\n🎉🏁 === FINALNA FLAGA === 🏁🎉');
                console.log(`🏆 ${finalFlag}`);
                console.log('🎉🏁 ==================== 🏁🎉');
            } else {
                console.log('\n❌ Nie udało się uzyskać flagi');
            }
            
            // Zamknij stdin żeby aplikacja mogła się zakończyć
            process.stdin.pause();

        } catch (error) {
            console.error('❌ Error:', error);
            process.stdin.pause();
            process.exit(1);
        }
    }


    private async downloadOrGetRafalsNotebook() {
        console.log('📖 Getting Rafał\'s notebook (PDF)...');
        const pdfUrl = 'https://c3ntrala.ag3nts.org/dane/notatnik-rafala.pdf';
        const pdfPath = path.join(this.cacheDir, 'notatnik-rafala.pdf');

        if (!fs.existsSync(pdfPath)) {
            console.log('📥 Downloading PDF from server...');
            const pdfBuffer = await this.downloadBinaryFile(pdfUrl);
            fs.writeFileSync(pdfPath, pdfBuffer);
            console.log('✅ PDF downloaded and cached');
        } else {
            console.log('📦 Using cached PDF file');
        }
        return pdfPath;
    }

    private displayResults(pdfContent: any, questionsData: QuestionWithContext[]) {
        console.log('\n🎉 All files ready in cache directory!');
        console.log('\nAvailable files:');
        console.log('- ./cache/notatnik-rafala.pdf (Original PDF)');
        console.log('- ./cache/notatnik-full-content.txt (Extracted text from all pages)');
        console.log('- ./cache/notes.json (Questions list)');

        // Display content preview
        console.log('\n📖 PDF Content Preview:');
        console.log(`Pages 1-18 text length: ${pdfContent.pages1to18.length} characters`);
        console.log(`Page 19 OCR text: ${pdfContent.page19Text.substring(0, 200)}...`);

        // Display questions preview
        if (Array.isArray(questionsData) && questionsData.length > 0) {
            console.log(`\n📝 Found ${questionsData.length} questions:`);
            questionsData.forEach(question => {
                console.log(`${question.id}. ${question.text}`);
            });
        }

        // Display cost summary
        const tokens = this.expenseCounter.getUsedTokens();
        const costs = this.expenseCounter.getEstimatedCost('gpt-4.1'); // Most calls use gpt-4.1
        
        console.log('\n💰 Cost Summary (so far):');
        console.log(`Model: ${costs.model}`);
        console.log(`Input tokens: ${tokens.input.toLocaleString()}`);
        console.log(`Output tokens: ${tokens.output.toLocaleString()}`);
        console.log(`Total tokens: ${tokens.total.toLocaleString()}`);
        console.log(`Estimated cost: $${costs.totalCost.toFixed(4)} USD`);
        console.log(`  - Input: $${costs.inputCost.toFixed(4)} USD`);
        console.log(`  - Output: $${costs.outputCost.toFixed(4)} USD`);

        console.log('\n🎯 Ready to analyze PDF content against questions!');
    }

    async answerQuestions(fullNotebookContent: string, questionsWithContext: QuestionWithContext[]): Promise<Answer[]> {
        console.log('\n🔍 Analyzing questions with AI - iterative approach...\n');
        
        const answers: Answer[] = [];
        
        for (const questionWithContext of questionsWithContext) {
            console.log(`\n🎯 Przetwarzam pytanie ${questionWithContext.id}: ${questionWithContext.text}`);
            
            try {
                // Przygotuj kontekst z feedback dla tego konkretnego pytania
                const feedbackContext = questionWithContext.feedbacks.length > 0 
                    ? `\n\nWAŻNE - WSKAZÓWKI DLA TEGO PYTANIA:\n${questionWithContext.feedbacks.map((feedback, index) => {
                        let parts = [`${index + 1}.`];
                        if (feedback.headquartersHint) {
                            parts.push(`Koniecznie uwzględnij przed odpowiedzią: ${feedback.headquartersHint}`);
                        }
                        if (feedback.incorrectValue) {
                            parts.push(`Błędna odpowiedź której NIE WOLNO Ci powtórzyć: ${feedback.incorrectValue}`);
                        }
                        if (feedback.transformedHint) {
                            parts.push(`Dodatkowa wskazówka: ${feedback.transformedHint}`);
                        }
                        return parts.join(' ');
                    }).join('\n')}\n\nTo są wskazówki z systemu oceniającego - MUSISZ je uwzględnić w swojej analizie!`
                    : '';
                
                // Wyświetl feedback tylko jeśli istnieje dla tego pytania
                if (questionWithContext.feedbacks.length > 0) {
                    console.log(`📝 Feedback dla pytania ${questionWithContext.id}:`);
                    questionWithContext.feedbacks.forEach((feedback, index) => {
                        console.log(`${index + 1}. Wskazówka z centrali: ${feedback.headquartersHint}`);
                        if (feedback.incorrectValue) {
                            console.log(`   Błędna odpowiedź: ${feedback.incorrectValue}`);
                        }
                        if (feedback.transformedHint) {
                            console.log(`   Rozbudowana wskazówka: ${feedback.transformedHint}`);
                        }
                    });
                    console.log(''); // Pusta linia dla czytelności
                } else {
                    console.log(`📝 Brak feedbacku dla pytania ${questionWithContext.id} - pierwsza próba\n`);
                }
                
                // Wyświetl dokładnie jaki feedback context jest przekazywany do modelu
                if (feedbackContext) {
                    console.log('📋 Feedback context przekazywany do modelu:');
                    console.log('═'.repeat(50));
                    console.log(feedbackContext);
                    console.log('═'.repeat(50));
                    console.log('');
                }
                
                const systemPrompt = `Jesteś ekspertem analizy tekstu. Przeanalizuj notatnik Rafała i odpowiedz na zadane pytanie precyzyjnie.

KONTEKST - NOTATNIK RAFAŁA:
${fullNotebookContent}

INSTRUKCJE:
- Przeczytaj uważnie cały notatnik
- Analizuj każdy szczegół w tekście, szukaj powiązań między faktami
- Zwróć szczególną uwagę na daty, lata, nazwy miejsc, imiona i wydarzenia
- Odpowiadaj krótko i precyzyjnie na pytanie
- Używaj dokładnych dat w formacie YYYY-MM-DD gdy jest to wymagane
- Jeśli pytanie dotyczy roku, podaj tylko rok (np. "2019")
- Jeśli pytanie dotyczy miejsca, podaj krótką nazwę miejsca
- Szukaj informacji w całym tekście, łącznie ze stroną 19 (OCR)
- Odpowiadaj "BRAK INFORMACJI" tylko gdy naprawdę nie ma żadnych wskazówek w tekście
- Łącz różne fragmenty tekstu żeby znaleźć pełną odpowiedź

${feedbackContext}`;

                const response = await this.openaiService.completion({
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Pytanie: ${questionWithContext.text}\n\nOdpowiedz krótko i precyzyjnie:` }
                    ],
                    model: "gpt-4.1"
                });

                const message = (response as any).choices[0].message.content?.trim() || "BRAK ODPOWIEDZI";
                console.log(`🤖 AI odpowiedź: ${message}`);
                
                // Zapisz odpowiedź
                const answer: Answer = {
                    questionId: questionWithContext.id,
                    message
                };
                answers.push(answer);
                console.log(`✅ Odpowiedź ${questionWithContext.id} zapisana: ${message}`);
                
                // Pauza między pytaniami
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`❌ Błąd przy pytaniu ${questionWithContext.id}:`, error);
                const errorAnswer: Answer = {
                    questionId: questionWithContext.id,
                    message: "BŁĄD TECHNICZNY"
                };
                answers.push(errorAnswer);
            }
            
            console.log(`\n📊 Pytanie ${questionWithContext.id} zakończone`);
        }

        return answers;
    }

    private analyzeHeadquartersResponse(result: any): { success: boolean; flag: string | null; errorMessage: string } {
        if (!result) return { success: false, flag: null, errorMessage: 'Nieznany format odpowiedzi' };
        
        console.log(`🔍 Analizuję odpowiedź z Centrali:`, result);
        
        // Sprawdź pole code
        if (typeof result === 'object' && 'code' in result) {
            if (result.code === 0) {
                console.log('🎉 SUKCES! Centrala zaakceptowała odpowiedzi.');
                console.log('🏁 FLAGA:', result.message);
                return { success: true, flag: result.message, errorMessage: '' };
            } else {
                console.log(`❌ BŁĄD! Kod: ${result.code}`);
                console.log(`📝 Opis błędu: ${result.message}`);
                return { success: false, flag: null, errorMessage: result.message };
            }
        }
        
        // Fallback dla niestandardowych odpowiedzi
        console.log('⚠️ Nieznany format odpowiedzi - analizuję tekst...');
        const message = typeof result === 'object' ? JSON.stringify(result) : String(result);
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('success') || lowerMessage.includes('correct')) {
            console.log('✅ Odpowiedź wydaje się pozytywna');
            return { success: true, flag: null, errorMessage: '' };
        }
        
        console.log('❌ Prawdopodobnie błąd');
        return { success: false, flag: null, errorMessage: message };
    }

    private findIncorrectQuestionId(result: HeadquartersResponse): string | null {
        if (!result || result.code === 0) {
            return null;
        }
        
        const message = result.message || '';
        
        // Szukaj wzorców typu "question 01", "question 02" etc.
        const questionMatch = message.match(/question (\d+)/i);
        if (questionMatch) {
            const questionNumber = questionMatch[1].padStart(2, '0'); // "01", "02", etc.
            console.log(`🎯 Zidentyfikowano błędne pytanie: ${questionNumber}`);
            return questionNumber;
        }
        
        console.log('⚠️ Nie można zidentyfikować konkretnego błędnego pytania');
        return null;
    }

        private identifyIncorrectQuestions(result: HeadquartersResponse, questionsData: QuestionWithContext[], feedback: Feedback): QuestionWithContext[] {
        if (!result || result.code === 0) {
            return [];
        }
        
        const incorrectQuestionId = this.findIncorrectQuestionId(result);
        
        if (incorrectQuestionId) {
            const incorrectQuestion = questionsData.find(q => q.id === incorrectQuestionId);
            if (incorrectQuestion) {
                return [{
                    id: incorrectQuestion.id,
                    text: incorrectQuestion.text,
                    feedbacks: [...incorrectQuestion.feedbacks, feedback]
                }];
            }
            return [];
        }
        
        // Jeśli nie można zidentyfikować konkretnego pytania, załóż że wszystkie są błędne
        console.log('⚠️ Powtarzam wszystkie pytania');
        return questionsData.map(question => ({
            id: question.id,
            text: question.text,
            feedbacks: [...question.feedbacks, feedback]
        }));
    }

    private async prepareFeedback(response: HeadquartersResponse, fullNotebookContent: string, questionsData: QuestionWithContext[]): Promise<Feedback> {
        const headquartersHint = ('hint' in response && response.hint) ? String(response.hint) : '';
        const incorrectValue = ('debug' in response && response.debug) ? String(response.debug) : '';

        const feedback: Feedback = {
            headquartersHint,
            incorrectValue,
            transformedHint: ''
        };

        const incorrectQuestionId = this.findIncorrectQuestionId(response);
        if (incorrectQuestionId) {
            const incorrectQuestionText = questionsData.find(q => q.id === incorrectQuestionId)?.text ?? '';
            feedback.transformedHint = await this.prepareImprovedHint(fullNotebookContent, incorrectQuestionId, incorrectQuestionText, incorrectValue, headquartersHint);
        }

        return feedback;
    }

    private async prepareImprovedHint(fullNotebookContent: string, incorrectQuestionId: string, incorrectQuestionText: string, incorrectValue: string, headquartersHint: string): Promise<string> {
        console.log(`🧠 Przygotowuję ulepszoną wskazówkę dla pytania ${incorrectQuestionId}: "${incorrectQuestionText}"...`);
        console.log(`📝 Błędna odpowiedź: "${incorrectValue}"`);
        console.log(`💡 Wskazówka z centrali: "${headquartersHint}"`);
        
        try {
            const notebookPrompt = `
            <NOTATNIK RAFAŁA>
            ${fullNotebookContent}
            </NOTATNIK RAFAŁA>
            `;
            const hintPrompt = `
            Jesteś ekspertem w analizowaniu i rozwiązywaniu zagadek.
            Kontekstem zagadki jest notatnik Rafała.

            Pytaniem dotyczącym notatnika Rafała było: "${incorrectQuestionText}"

            Model gpt-4.1 próbował odpowiedzieć na to pytanie, ale nie udało mu się.

            BŁĘDNA odpowiedź brzmiała: "${incorrectValue}"

            Wskazówka od twórcy zagadki brzmi: "${headquartersHint}"

            Twoim zadaniem jest przeanalizowanie wszystkich informacji i zwrócenie usprawnionej wskazówki dla modelu gpt-4.1, która pozwoli mu odpowiedzieć zadane uprzednio na pytanie.
            
            Zwróć konkretną, praktyczną wskazówkę która pomoże modelowi znaleźć prawidłową odpowiedź.`;

            console.log('🤖 Wysyłam zapytanie do AI o ulepszoną wskazówkę...');
            
            const response = await this.openaiService.completion({
                messages: [
                    { role: "system", content: notebookPrompt },
                    { role: "user", content: hintPrompt }
                ],
                model: "gpt-4.1"
            });
            
            const improvedHint = (response as any).choices[0].message.content?.trim() || '';
            
            console.log('✅ Otrzymano ulepszoną wskazówkę:');
            console.log(`📋 "${improvedHint}"`);
            
            return improvedHint;
            
        } catch (error) {
            console.error(`❌ Błąd podczas przygotowywania ulepszonej wskazówki dla pytania ${incorrectQuestionId}:`, error);
            return `Błąd podczas przygotowywania wskazówki: ${error}`;
        }
    }

    private async downloadBinaryFile(url: string): Promise<Buffer> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download ${url}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer);
    }

    /**
     * Get page 19 image base64 for LLM usage
     */
    getPage19ImageBase64(): string | null {
        return this.page19ImageBase64;
    }

    /**
     * Utility method to easily send page 19 image to LLM with custom prompt
     */
    async analyzeImageWithLLM(base64Image: string, prompt: string, contextId: string = 'page19-analysis'): Promise<any> {
        console.log(`🤖 Analizuję obraz strony 19 z promptem: ${prompt.substring(0, 100)}...`);
        try {
            const result = await this.openaiService.processImageWithPrompt(base64Image, prompt, contextId);
            console.log('✅ Analiza obrazu zakończona');
            return result;
        } catch (error) {
            console.error('❌ Błąd podczas analizy obrazu:', error);
            throw error;
        }
    }

    /**  
     * Analyze page 19 image with custom prompt (convenience method)
     */
    async analyzePage19WithPrompt(prompt: string, contextId: string = 'page19-analysis'): Promise<any> {
        if (!this.page19ImageBase64) {
            throw new Error('Page 19 image not available. Make sure PDF processing is completed first.');
        }
        return this.analyzeImageWithLLM(this.page19ImageBase64, prompt, contextId);
    }
}

// Run the application
const app = new App();
app.run().catch(console.error);