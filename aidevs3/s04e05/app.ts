import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { OpenAIService } from '../shared/OpenAIService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// Use require for pdf-parse-debugging-disabled to avoid type issues
const pdfParse = require('pdf-parse-debugging-disabled');
const execAsync = promisify(exec);

class PdfProcessor {
    private openaiService: OpenAIService;
    private cacheService: CacheService;

    constructor(openaiService: OpenAIService, cacheService: CacheService) {
        this.openaiService = openaiService;
        this.cacheService = cacheService;
    }

    async extractTextFromPdf(pdfPath: string): Promise<{ pages1to18: string, page19Text: string }> {
        // Extract text from pages 1-18
        console.log('📄 Extracting text from pages 1-18...');
        const pages1to18Text = await this.cacheService.getOrFetch('pdf-text-pages-1-18.txt', async () => {
            const dataBuffer = fs.readFileSync(pdfPath);
            const data = await pdfParse(dataBuffer);
            return data.text;
        });

        // Process page 19 with OCR
        console.log('🖼️ Processing page 19 with OCR...');
        const page19Text = await this.cacheService.getOrFetch('pdf-page-19-ocr.txt', async () => {
            try {
                console.log('🔄 Starting PDF page conversion...');
                
                // Use ImageMagick directly to convert page 19 (index 18) to PNG
                const imagePath = path.join(path.dirname(pdfPath), 'page19.png');
                const command = `magick "${pdfPath}[18]" -density 300 -resize 2000x2000 -quality 95 "${imagePath}"`;
                
                console.log(`📝 Running command: ${command}`);
                await execAsync(command);
                console.log('✅ PDF page converted successfully');
                
                // Use OpenAI Vision to extract text from the image
                console.log('👁️ Using AI vision to extract text from page 19...');
                const base64Image = fs.readFileSync(imagePath, 'base64');
                console.log(`📏 Base64 image size: ${base64Image.length} characters`);
                
                const prompt = `Jesteś ekspertem OCR. Przeanalizuj ten obraz, który zawiera odręczne notatki w języku polskim. 
                Wyekstrahuj cały tekst z tego obrazu jak najdokładniej. 
                Zwróć odpowiedź w formacie JSON z polem "preview" zawierającym wyekstrahowany tekst.
                Jeśli jakieś słowa są nieczytelne, oznacz je jako [NIECZYTELNE].`;

                console.log('🤖 Calling OpenAI Vision API...');
                const result = await this.openaiService.processImageWithPrompt(base64Image, prompt, 'page19');
                console.log('✅ OpenAI Vision API completed');
                
                return result.preview;
            } catch (error) {
                console.error('❌ Error during page 19 processing:', error);
                throw error;
            }
        });

        return {
            pages1to18: pages1to18Text,
            page19Text: page19Text
        };
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

            // Save processed content
            const fullContentPath = path.join(this.cacheDir, 'notatnik-full-content.txt');
            const fullContent = `=== STRONY 1-18 (TEKST) ===\n\n${pdfContent.pages1to18}\n\n=== STRONA 19 (OCR) ===\n\n${pdfContent.page19Text}`;
            fs.writeFileSync(fullContentPath, fullContent);
            console.log(`✅ Full PDF content saved to: ${fullContentPath}`);

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
            
            const questionsData = JSON.parse(questionsDataString);
            
            // Display final results and costs
            this.displayResults(pdfContent, questionsData);

            // Now answer the questions using AI with iterative feedback
            console.log('\n🤖 Rozpoczynam iteracyjną analizę pytań...');
            const fullNotebookContent = fs.readFileSync(fullContentPath, 'utf-8');
            
            // Wczytaj poprawne odpowiedzi z poprzednich uruchomień
            const correctAnswersPath = path.join(this.cacheDir, 'correct-answers.json');
            let correctAnswers: Record<string, string> = {};
            
            if (fs.existsSync(correctAnswersPath)) {
                try {
                    const cachedAnswers = JSON.parse(fs.readFileSync(correctAnswersPath, 'utf-8'));
                    correctAnswers = cachedAnswers;
                    console.log('📦 Wczytano poprawne odpowiedzi z keszu:');
                    Object.entries(correctAnswers).forEach(([id, answer]) => {
                        console.log(`  ${id}: ${answer}`);
                    });
                } catch (error) {
                    console.log('⚠️ Błąd wczytywania keszu odpowiedzi, zaczynam od nowa');
                }
            } else {
                console.log('📝 Brak keszu odpowiedzi - pierwsza sesja');
            }
            
            let answers: Record<string, string> = {};
            let questionFeedback: Record<string, string[]> = {}; // Feedback per pytanie
            let finalFlag: string | null = null;
            let analysisResult: { success: boolean; flag: string | null; errorMessage: string } | null = null;
            
            // Określ które pytania trzeba zadać (te które nie są w keszu)
            const allQuestionIds = Object.keys(questionsData);
            let questionsToAsk: string[] = allQuestionIds.filter(id => !correctAnswers[id]);
            
            if (questionsToAsk.length === 0) {
                console.log('🎉 Wszystkie odpowiedzi są już w keszu! Sprawdzam z Centralą...');
            } else {
                console.log(`📝 Pytania do zadania: ${questionsToAsk.join(', ')}`);
                console.log(`✅ Pytania z keszu: ${Object.keys(correctAnswers).join(', ') || 'brak'}`);
            }
            
            const maxIterations = 5;
            
            for (let iteration = 1; iteration <= maxIterations; iteration++) {
                console.log(`\n🔄 === ITERACJA ${iteration}/${maxIterations} ===`);
                
                // Wyświetl informację o pytaniach do zadania
                if (questionsToAsk.length === 0) {
                    console.log('📝 Wszystkie odpowiedzi z keszu - sprawdzam z Centralą');
                } else if (questionsToAsk.length === allQuestionIds.length) {
                    console.log('📝 Zadaję wszystkie pytania (brak keszu)');
                } else {
                    console.log(`📝 Keszowanie: zadaję tylko pytania: ${questionsToAsk.join(', ')}`);
                }
                
                // Zadaj pytania (tylko te które nie są w keszu)
                let newAnswers: Record<string, string> = {};
                if (questionsToAsk.length > 0) {
                    newAnswers = await this.answerQuestions(fullNotebookContent, questionsData, questionFeedback, questionsToAsk);
                }
                
                // Połącz nowe odpowiedzi z keszowanymi poprawnymi
                answers = { ...correctAnswers, ...newAnswers };
                
                console.log('\n📋 Finalne odpowiedzi z tej iteracji:');
                // Sortuj odpowiedzi po numerze pytania
                const sortedAnswers = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
                sortedAnswers.forEach(([id, answer]) => {
                    const source = correctAnswers[id] ? '🟢 (kesz)' : '🆕 (nowe)';
                    console.log(`${id}: ${answer} ${source}`);
                });

                // Wyślij wszystkie odpowiedzi do centrali
                console.log('\n📤 Wysyłanie odpowiedzi do Centrali...');
                try {
                    const result = await this.headquartersService.report('notes', answers);
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
                        
                        // Określ które pytania są błędne na podstawie odpowiedzi Centrali
                        const incorrectQuestions = this.identifyIncorrectQuestions(result);
                        console.log(`🔍 Błędne pytania do poprawienia: ${incorrectQuestions.join(', ')}`);
                        
                        // Aktualizuj keszowane poprawne odpowiedzi
                        // Wszystkie pytania które nie są błędne, zostają jako poprawne
                        Object.keys(answers).forEach(questionId => {
                            if (!incorrectQuestions.includes(questionId)) {
                                correctAnswers[questionId] = answers[questionId];
                                console.log(`✅ Pytanie ${questionId} zostaje w keszu jako poprawne`);
                            }
                        });
                        
                        // Zapisz aktualne poprawne odpowiedzi do pliku
                        if (Object.keys(correctAnswers).length > 0) {
                            fs.writeFileSync(correctAnswersPath, JSON.stringify(correctAnswers, null, 2));
                            console.log(`💾 Zapisano poprawne odpowiedzi do keszu (${Object.keys(correctAnswers).length} pytań)`);
                        }
                        
                        // Przygotuj pytania do zadania w następnej iteracji
                        questionsToAsk = incorrectQuestions;
                        
                        // Dodaj feedback tylko dla błędnych pytań
                        if (incorrectQuestions.length > 0) {
                            let feedbackMessage = '';
                            if ('hint' in result && result.hint) {
                                feedbackMessage += `Wskazówka: ${result.hint}`;
                            }
                            if ('debug' in result && result.debug) {
                                if (feedbackMessage) feedbackMessage += ' ';
                                feedbackMessage += `Błędna odpowiedź której NIE WOLNO Ci powtórzyć: ${result.debug}`;
                            }
                            if (feedbackMessage) {
                                // Przypisz feedback do wszystkich błędnych pytań
                                incorrectQuestions.forEach(questionId => {
                                    if (!questionFeedback[questionId]) {
                                        questionFeedback[questionId] = [];
                                    }
                                    questionFeedback[questionId].push(feedbackMessage);
                                });
                            }
                        }
                        
                        if (iteration === maxIterations) {
                            console.log('⚠️ Osiągnięto maksymalną liczbę iteracji. Kończę z ostatnimi odpowiedziami.');
                        }
                    }
                    
                } catch (error) {
                    console.error(`❌ Błąd w iteracji ${iteration}:`, error);
                    // Przypisz błąd techniczny do wszystkich pytań które były zadawane
                    questionsToAsk.forEach(questionId => {
                        if (!questionFeedback[questionId]) {
                            questionFeedback[questionId] = [];
                        }
                        questionFeedback[questionId].push(`Iteracja ${iteration}: Błąd techniczny: ${error}. Spróbuj inne podejście.`);
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
            Object.entries(answers).forEach(([id, answer]) => {
                console.log(`${id}: ${answer}`);
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

    private displayResults(pdfContent: any, questionsData: any) {
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
        if (typeof questionsData === 'object' && questionsData) {
            const questions = Object.entries(questionsData);
            console.log(`\n📝 Found ${questions.length} questions:`);
            questions.forEach(([id, question]: [string, any]) => {
                console.log(`${id}. ${question}`);
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

    async answerQuestions(fullNotebookContent: string, questionsData: any, questionFeedback: Record<string, string[]>, questionsToAsk: string[]): Promise<Record<string, string>> {
        console.log('\n🔍 Analyzing questions with AI - iterative approach...\n');
        
        const answers: Record<string, string> = {};
        
        for (const questionId of questionsToAsk) {
            console.log(`\n🎯 Przetwarzam pytanie ${questionId}: ${questionsData[questionId]}`);
            
            try {
                // Przygotuj kontekst z feedback dla tego konkretnego pytania
                const feedbackForQuestion = questionFeedback[questionId] || [];
                const feedbackContext = feedbackForQuestion.length > 0 
                    ? `\n\nWAŻNE - FEEDBACK DLA TEGO PYTANIA:\n${feedbackForQuestion.join('\n')}\n\nTo są wskazówki z systemu oceniającego - MUSISZ je uwzględnić w swojej analizie!`
                    : '';
                
                // Wyświetl feedback tylko jeśli istnieje dla tego pytania
                if (feedbackForQuestion.length > 0) {
                    console.log(`📝 Feedback dla pytania ${questionId}:`);
                    feedbackForQuestion.forEach((hint, index) => {
                        console.log(`${index + 1}. ${hint}`);
                    });
                    console.log(''); // Pusta linia dla czytelności
                } else {
                    console.log(`📝 Brak feedbacku dla pytania ${questionId} - pierwsza próba\n`);
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
                        { role: "user", content: `Pytanie: ${questionsData[questionId]}\n\nOdpowiedz krótko i precyzyjnie:` }
                    ],
                    model: "gpt-4.1"
                });

                const answer = (response as any).choices[0].message.content?.trim() || "BRAK ODPOWIEDZI";
                console.log(`🤖 AI odpowiedź: ${answer}`);
                
                // Zapisz odpowiedź i przejdź do następnego pytania
                answers[questionId] = answer;
                console.log(`✅ Odpowiedź ${questionId} zapisana: ${answer}`);
                
                // Pauza między pytaniami
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`❌ Błąd przy pytaniu ${questionId}:`, error);
                answers[questionId] = "BŁĄD TECHNICZNY";
            }
            
            console.log(`\n📊 Pytanie ${questionId} zakończone`);
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

    private identifyIncorrectQuestions(result: any): string[] {
        if (!result) return [];
        
        // Sprawdź standardowy format z kodem błędu
        if (typeof result === 'object' && 'code' in result) {
            if (result.code === 0) {
                // Sukces - nie ma błędnych pytań
                return [];
            } else if (result.code !== 0) {
                // Błąd - sprawdź czy można zidentyfikować które pytanie
                const message = result.message || '';
                
                // Szukaj wzorców typu "question 01", "question 02" etc.
                const questionMatch = message.match(/question (\d+)/i);
                if (questionMatch) {
                    const questionNumber = questionMatch[1].padStart(2, '0'); // "01", "02", etc.
                    console.log(`🎯 Zidentyfikowano błędne pytanie: ${questionNumber}`);
                    return [questionNumber];
                }
                
                // Jeśli nie można zidentyfikować konkretnego pytania, załóż że wszystkie są błędne
                console.log('⚠️ Nie można zidentyfikować konkretnego błędnego pytania - powtarzam wszystkie');
                return Object.keys(this.getQuestionsData()); // Zwróć wszystkie ID pytań
            }
        }
        
        return [];
    }

    private getQuestionsData(): any {
        // Helper method to get questions data - this should be passed or stored
        return {
            "01": "Do którego roku przeniósł się Rafał",
            "02": "Kto wpadł na pomysł, aby Rafał przeniósł się w czasie?",
            "03": "Gdzie znalazł schronienie Rafał? Nazwij krótko to miejsce",
            "04": "Którego dnia Rafał ma spotkanie z Andrzejem? (format: YYYY-MM-DD)",
            "05": "Gdzie się chce dostać Rafał po spotkaniu z Andrzejem?"
        };
    }

    private async downloadBinaryFile(url: string): Promise<Buffer> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download ${url}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer);
    }
}

// Run the application
const app = new App();
app.run().catch(console.error);