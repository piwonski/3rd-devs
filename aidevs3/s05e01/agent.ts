import { HeadquartersService } from "../shared/HeadquartersService";
import { RequestService } from "../shared/RequestService";
import { CacheService } from "../shared/CacheService";
import { Environment } from "../shared/Environment";
import { OpenAIService } from "../shared/OpenAIService";
import { ExpenseCounter } from "../shared/ExpenseCounter";
import * as path from 'path';
import { DownloadService } from "../shared/DownloadService";
import { UnzipService } from "../shared/UnzipService";
import type { Question, Answer, QuestionWithContext, Feedback } from "../shared/agentTypes";
import { UnicodeUtils } from "../shared/UnicodeUtils";

interface AgentContext {
    factSummaries: Record<string, string>;
    phoneTranscriptions: Record<string, string>;
}

interface AgentState {
    context: AgentContext;
    questions: QuestionWithContext[];
    answers: Answer[];
    flag?: string; // Flaga z centrali jeśli została otrzymana
}

export class Agent {
    private readonly requestService: RequestService;
    private readonly headquartersService: HeadquartersService;
    private readonly cacheService: CacheService;
    private readonly downloadService: DownloadService;
    private readonly unzipService: UnzipService;
    private readonly openAIService: OpenAIService;
    private readonly expenseCounter: ExpenseCounter;
    private readonly unicodeUtils: UnicodeUtils;
    private state: AgentState;

    constructor() {
        const cacheDir = path.join(__dirname, 'cache');
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheService = new CacheService(cacheDir);
        this.downloadService = new DownloadService(cacheDir);
        this.unzipService = new UnzipService(cacheDir);
        this.expenseCounter = new ExpenseCounter();
        this.openAIService = new OpenAIService(3072, this.expenseCounter);
        this.unicodeUtils = new UnicodeUtils();
        this.state = {
            context: {
                factSummaries: {},
                phoneTranscriptions: {},
            },
            questions: [],
            answers: [],
        }
        console.log(`📁 Using cache directory: ${cacheDir}`);
    }

    async run() {
        try {
            console.log("🚀 Agent starting...");
            
            this.state.context = await this.prepareContext();
            this.state.questions = await this.prepareQuestions();
            
            // Załaduj poprawne odpowiedzi z cache jeśli istnieją
            await this.loadCorrectAnswersFromCache();

            // If we have all answers but no flag, try resubmitting
            if (this.state.answers.length === this.state.questions.length && !this.state.flag) {
                console.log("\n🔄 All answers present but no flag - resubmitting to headquarters...");
                await this.resubmitAnswers();
            } else {
                await this.solveQuestions();
            }
            
            console.log("\n💰 ================================");
            console.log("💰 PODSUMOWANIE KOSZTÓW");
            console.log("💰 ================================");
            const usedTokens = this.expenseCounter.getUsedTokens();
            const costBreakdown = this.expenseCounter.getEstimatedCost('gpt-4.1');
            console.log(`📊 Tokeny - Input: ${usedTokens.input}, Output: ${usedTokens.output}, Total: ${usedTokens.total}`);
            console.log(`💵 Szacowany koszt: $${costBreakdown.totalCost.toFixed(4)} (${costBreakdown.model})`);
            console.log("💰 ================================");
            
            console.log("\n✅ Agent completed successfully");
            
        } catch (error) {
            const errorInfo = error instanceof Error 
            ? { error: error.message, stack: error.stack }
            : { error: String(error) };
            console.log("❌ Agent failed with error", errorInfo);
            throw error;
        }
    }

    private async solveQuestions() {
        console.log("\n🔍 === SOLVING QUESTIONS ===");
        
        const maxIterationsPerQuestion = 3;
        
        // Rozwiązuj pytania jedno po drugim
        for (const question of this.state.questions) {
            // Sprawdź czy pytanie już zostało rozwiązane
            const existingAnswer = this.state.answers.find(a => a.questionId === question.id);
            if (existingAnswer) {
                console.log(`\n✅ Question ${question.id} already solved: ${existingAnswer.message}`);
                continue;
            }
            
            console.log(`\n🔍 Solving question ${question.id}: ${question.text}`);
            
            // Analiza pytania - co potrzebujemy żeby odpowiedzieć
            const strategy = await this.analyzeQuestionStrategy(question);
            console.log(`📋 Strategy: ${strategy}`);
            
            let questionResolved = false;
            let iteration = 1;
            
            while (!questionResolved && iteration <= maxIterationsPerQuestion) {
                console.log(`\n🔄 Iteration ${iteration}/${maxIterationsPerQuestion} for question ${question.id}`);
                
                // Rozwiąż pytanie na podstawie strategii
                const answer = await this.solveQuestion(question, strategy);
                console.log(`💭 Generated answer for ${question.id}: ${answer}`);
                
                // Wyślij odpowiedzi do centrali (dotychczasowe + nowa)
                const result = await this.submitCurrentAnswers(question.id, answer);
                
                if (result.code === 0) {
                    // Odpowiedź zaakceptowana - zapisz do stanu
                    await this.addAnswerForQuestionToState(question.id, answer);
                    console.log(`🎉 Question ${question.id} accepted and saved to state!`);
                    
                    // Sprawdź czy otrzymaliśmy flagę
                    if (result.message && result.message.includes('FLG:')) {
                        this.state.flag = result.message;
                        console.log(`🏁 FLAGA OTRZYMANA: ${result.message}`);
                    }
                    
                    questionResolved = true;
                } else {
                    // Sprawdź czy błąd dotyczy aktualnego pytania czy kolejnego
                    const errorQuestionId = this.extractQuestionIdFromError(result.message);
                    
                    if (errorQuestionId === question.id) {
                        // Błąd dotyczy aktualnego pytania - trzeba je poprawić
                        console.log(`❌ Question ${question.id} rejected (iteration ${iteration}): ${result.message}`);
                        
                        if (iteration < maxIterationsPerQuestion) {
                            // Dodaj feedback do pytania
                            question.feedbacks.push({
                                headquartersHint: result.message,
                                incorrectValue: answer,
                                transformedHint: result.message
                            });
                            console.log(`➡️  Will retry with feedback in next iteration...`);
                            iteration++;
                        } else {
                            console.log(`⚠️  Max iterations (${maxIterationsPerQuestion}) reached for question ${question.id}.`);
                            console.log(`❌ Cannot proceed with remaining questions - centrala won't provide flag with incorrect answers.`);
                            console.log(`📋 Stopping execution. Please review and fix the issue manually.`);
                            return; // Przerwij całą funkcję
                        }
                    } else {
                        // Błąd dotyczy kolejnego pytania - aktualne pytanie jest poprawne
                        await this.addAnswerForQuestionToState(question.id, answer);
                        console.log(`🎉 Question ${question.id} accepted and saved to state! (Error message refers to next question: ${errorQuestionId})`);
                        console.log(`ℹ️  Next question ${errorQuestionId} will need attention: ${result.message}`);
                        questionResolved = true;
                    }
                }
            }
        }
        
        console.log("\n📋 Final answers:", this.state.answers);
        
        // Sprawdź czy wszystkie pytania zostały rozwiązane
        const allQuestionsAnswered = this.state.answers.length === this.state.questions.length;
        if (allQuestionsAnswered) {
            console.log("\n🎉 ================================");
            console.log("🏆 ZADANIE UKOŃCZONE POMYŚLNIE!");
            console.log("🎯 Wszystkie pytania zostały rozwiązane!");
            
            if (this.state.flag) {
                console.log(`🏁 FLAGA: ${this.state.flag}`);
            } else {
                console.log("⚠️  Brak flagi - sprawdź czy wszystkie odpowiedzi są poprawne");
            }
            
            console.log("🎉 ================================");
        } else {
            console.log(`\n⚠️  Zadanie niepełne: ${this.state.answers.length}/${this.state.questions.length} pytań rozwiązanych`);
        }
    }

    private extractQuestionIdFromError(errorMessage: string): string | null {
        // Parsuj różne formaty wiadomości błędów od centrali
        // Przykłady:
        // "Answer for question 01 is incorrect"
        // "Answer for question 02 is too short"
        // "Answer for question 03 is too long"
        
        const match = errorMessage.match(/question (\d+)/i);
        return match ? match[1] : null;
    }

    private async prepareContext(): Promise<AgentContext> {
        // Ensure cache directory exists
        await this.cacheService.ensureCacheDirectory();

        console.log("📞 Fetching phone transcriptions...");
        const transcriptionsData = await this.cacheService.getOrFetchJson('phone_sorted.json', async () => {
            const data = await this.headquartersService.getSortedPhoneTranscriptions();
            const parsed = JSON.parse(data);
            return this.unicodeUtils.decodeUnicode(parsed);
        });
        console.log("✅ Phone transcriptions received", { count: Object.keys(transcriptionsData).length });

        // Download and unzip factory files
        await this.downloadAndUnzipPlikiZFabryki();

        // Read all fact files
        const facts: Record<string, string> = await this.readFacts();

        console.log("✅ Facts loaded", { count: Object.keys(facts).length });

        // Create summaries of facts
        const factSummaries = await this.cacheService.getOrFetchJson('fact-summaries.json', async () => {
            return await this.createFactSummaries(facts);
        });
        console.log("✅ Fact summaries ready");

        console.log("📋 Data summary completed");
        return {
            factSummaries,
            phoneTranscriptions: transcriptionsData,
        }
    }

    private async prepareQuestions(): Promise<QuestionWithContext[]> {
        console.log("❓ Fetching phone questions...");
        const questionsData = await this.cacheService.getOrFetchJson('phone-questions.json', async () => {
            const data = await this.headquartersService.getPhoneQuestions();
            const parsed = JSON.parse(data);
            return this.unicodeUtils.decodeUnicode(parsed);
        });
        console.log("✅ Phone questions received", { count: Object.keys(questionsData).length });
        console.log("❓ Phone questions:", questionsData);
        return Object.entries(questionsData).map(([id, text]) => ({ 
            id, 
            text: text as string,
            feedbacks: [] as Feedback[]
        }));
    }

    private async downloadAndUnzipPlikiZFabryki() {
        if (!await this.cacheService.fileExists('pliki_z_fabryki.zip')) {
            const password = Environment.getFilesFromFactoryZipPassword();
            const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;
            const zipFileName = 'pliki_z_fabryki.zip';

            console.log("📥 Downloading factory files...");
            await this.downloadService.downloadFile(zipUrl, zipFileName);
            console.log("✅ Factory files downloaded");

            console.log("📦 Unzipping factory files...");
            await this.unzipService.unzipFile({ zipPaths: [zipFileName], password });
            console.log("✅ Factory files unzipped");
        } else {
            console.log("📁 Factory files already exist in cache");
        }
    }

    private async readFacts() {
        const facts: Record<string, string> = {};
        // Read facts from factory files
        console.log("📖 Reading facts from factory files...");
        const factFiles = await this.cacheService.listFiles('pliki_z_fabryki', 'facts');

        for (const factFile of factFiles.filter(f => f.endsWith('.txt'))) {
            const factContent = await this.cacheService.readFile('pliki_z_fabryki', 'facts', factFile);
            if (factContent) {
                const factKey = factFile.replace('.txt', '');
                facts[factKey] = factContent.trim();
                console.log(`📄 Loaded fact: ${factKey}`);
            }
        }
        return facts;
    }

    private async createFactSummaries(facts: Record<string, string>) {
        const summaries: Record<string, string> = {};
        console.log("🧠 Creating fact summaries...");
        
        const factsKeywordsPrompt = `
Read the following facts and extract key information. 
If the fact is about a person, provide also information about the person's identity, occupation, skills, names of technologies the person is familiar with, etc.
Use strict sentence structure. 
DON'T use bullet points, paragraphs, etc.
`;
        
        for (const [factKey, factContent] of Object.entries(facts)) {
            console.log(`🔍 Processing fact: ${factKey}`);
            
            const messages = [
                { role: "system" as const, content: factsKeywordsPrompt },
                { role: "user" as const, content: factContent }
            ];
            
            const response = await this.openAIService.completion({ messages });
            const summary = (response as any).choices[0].message.content || "";
            summaries[factKey] = summary.trim();
            
            console.log(`✅ Summary created for ${factKey}`);
        }
        
        return summaries;
    }

    private async analyzeQuestionStrategy(question: QuestionWithContext): Promise<string> {
        const strategyPrompt = `
Przeanalizuj poniższe pytanie i wybierz jedną z dwóch strategii:

ANALIZA DANYCH
- Użyj gdy odpowiedź można znaleźć w rozmowach telefonicznych lub faktach z fabryki
- Analizuj transkrypcje, fakty, szukaj wzorców, kłamstw, niespójności

WYWOŁANIE API  
- Użyj gdy pytanie explicite pyta o odpowiedź z API lub endpoint
- Wymaga znalezienia endpointu i hasła w rozmowach, następnie wywołania API

Pytanie: "${question.text}"

Odpowiedz TYLKO jedną z opcji:
- "ANALIZA DANYCH" - jeśli trzeba analizować dane
- "WYWOŁANIE API" - jeśli trzeba wywołać API
`;

        const messages = [
            { role: "system" as const, content: "Wybierz strategię rozwiązania pytania. Odpowiedz tylko 'ANALIZA DANYCH' lub 'WYWOŁANIE API'." },
            { role: "user" as const, content: strategyPrompt }
        ];
        
        const response = await this.openAIService.completion({ messages });
        return (response as any).choices[0].message.content?.trim() || "";
    }

    private async solveQuestion(question: QuestionWithContext, strategy: string): Promise<string> {
        const contextData = {
            phoneTranscriptions: this.state.context.phoneTranscriptions,
            factSummaries: this.state.context.factSummaries
        };

        // Przygotuj feedback context jeśli istnieje
        const feedbackContext = question.feedbacks.length > 0
            ? `\n\nFEEDBACK Z POPRZEDNICH PRÓB:\n${question.feedbacks.map((feedback, index) => 
                `${index + 1}. Błąd: "${feedback.headquartersHint}" (poprzednia odpowiedź: "${feedback.incorrectValue}")`
            ).join('\n')}`
            : '';

        if (strategy.includes("WYWOŁANIE API")) {
            return await this.solveWithAPIStrategy(question, contextData, feedbackContext);
        } else {
            // Default to data analysis strategy
            return await this.solveWithDataStrategy(question, contextData, feedbackContext);
        }
    }

    private async solveWithDataStrategy(question: QuestionWithContext, contextData: any, feedbackContext: string): Promise<string> {
        // Przygotuj już udzielone poprawne odpowiedzi
        const correctAnswersContext = this.state.answers.length > 0 
            ? `\n\nJUŻ UDZIELONE POPRAWNE ODPOWIEDZI:\n${this.state.answers.map(answer => {
                const questionText = this.state.questions.find(q => q.id === answer.questionId)?.text || 'Unknown question';
                return `${answer.questionId}. ${questionText}\nOdpowiedź: ${answer.message}`;
            }).join('\n\n')}`
            : '';

        const solvingPrompt = `
Odpowiedz na pytanie analizując dostępne dane.

Pytanie: "${question.text}"
${feedbackContext}
${correctAnswersContext}

PRZYKŁAD ANALIZY SEKWENCJI ROZMÓW:
Jeśli rozmowa1 kończy się: "mam Zygfryda na drugiej linii [*dźwięk odkładanej słuchawki*]"
A rozmowa2 zaczyna się: "Witaj Samuelu. Rozmawiałeś z nią?"
To znaczy, że Zygfryd dzwoni do Samuela po tym jak Samuel skończył rozmowę z "nią" w rozmowie1.
Więc w rozmowie1 rozmawiali Samuel i ta "ona".

Dostępne dane:
ROZMOWY TELEFONICZNE:
${JSON.stringify(contextData.phoneTranscriptions, null, 2)}

FAKTY Z FABRYKI:
${JSON.stringify(contextData.factSummaries, null, 2)}

INSTRUKCJE:
- Analizuj dokładnie rozmowy i fakty
- Szukaj niespójności, kłamstw, konfliktów między tym co ktoś mówi a faktami
- Identyfikuj postacie na podstawie kontekstu rozmów
- KRYTYCZNE: Analizuj SEKWENCJĘ rozmów - sprawdź jak kończy się jedna rozmowa a jak zaczyna następna
- ŁĄCZ INFORMACJE między rozmowami (np. jeśli rozmowa1 kończy się "dzwonię do X", to rozmowa2 może zaczynać się od X dzwoniącego)
- Sprawdzaj kto do kogo dzwoni i w jakiej kolejności
- Dla identyfikacji rozmówców: użyj końca jednej rozmowy + początku następnej + potwierdzeń w tekście
- WYKORZYSTAJ już udzielone poprawne odpowiedzi do analizy powiązań
- Jeśli jest feedback, uwzględnij go i popraw błędy
- ODPOWIEDŹ MUSI BYĆ BARDZO KRÓTKA (1-3 słowa maksymalnie: imię, URL, słowo kluczowe)
- Odpowiedz w formacie JSON:

{
  "thinking": "Twój proces myślenia i analizy z uwzględnieniem poprzednich odpowiedzi",
  "answer": "Bardzo krótka odpowiedź (np. Samuel, https://rafal.ag3nts.org/b46c3, Witek)"
}
`;

        const messages = [
            { role: "system" as const, content: "Jesteś ekspertem od analizy rozmów i faktów. Daj bardzo krótką odpowiedź w formacie JSON." },
            { role: "user" as const, content: solvingPrompt }
        ];

        const response = await this.openAIService.completion({ messages });
        const responseText = (response as any).choices[0].message.content?.trim() || "";

        try {
            const parsed = JSON.parse(responseText);
            console.log(`🧠 Thinking: ${parsed.thinking}`);
            return parsed.answer;
        } catch (error) {
            console.error("❌ Failed to parse JSON response:", responseText);
            return responseText; // Fallback to raw response
        }
    }

    private async solveWithAPIStrategy(question: QuestionWithContext, contextData: any, feedbackContext: string): Promise<string> {
        // Przygotuj już udzielone poprawne odpowiedzi
        const correctAnswersContext = this.state.answers.length > 0 
            ? `\n\nJUŻ UDZIELONE POPRAWNE ODPOWIEDZI:\n${this.state.answers.map(answer => {
                const questionText = this.state.questions.find(q => q.id === answer.questionId)?.text || 'Unknown question';
                return `${answer.questionId}. ${questionText}\nOdpowiedź: ${answer.message}`;
            }).join('\n\n')}`
            : '';

        const solvingPrompt = `
Znajdź endpoint i hasło w rozmowach telefonicznych aby odpowiedzieć na pytanie.

Pytanie: "${question.text}"
${feedbackContext}
${correctAnswersContext}

Dostępne dane:
ROZMOWY TELEFONICZNE:
${JSON.stringify(contextData.phoneTranscriptions, null, 2)}

INSTRUKCJE:
- Przeanalizuj rozmowy i znajdź endpoint API oraz hasło
- WYKORZYSTAJ już udzielone poprawne odpowiedzi (np. kto skłamał) do wyboru właściwego endpointu
- Jeśli jest feedback, uwzględnij go i popraw błędy
- Odpowiedz w formacie JSON:

{
  "thinking": "Twój proces myślenia z uwzględnieniem poprzednich odpowiedzi",
  "endpoint": "URL endpointu do wywołania",
  "body": {"password": "hasło do przesłania"}
}
`;

        const messages = [
            { role: "system" as const, content: "Znajdź endpoint i hasło w rozmowach. Odpowiedz w formacie JSON." },
            { role: "user" as const, content: solvingPrompt }
        ];

        const response = await this.openAIService.completion({ messages });
        const responseText = (response as any).choices[0].message.content?.trim() || "";

        try {
            const parsed = JSON.parse(responseText);
            console.log(`🧠 Thinking: ${parsed.thinking}`);
            console.log(`🔗 Calling API: ${parsed.endpoint}`);
            
            // Wywołaj API
            const apiResponse = await this.requestService.post(parsed.endpoint, parsed.body);
            
            // Zwróć odpowiedź z API
            if (apiResponse && typeof apiResponse === 'object' && 'message' in apiResponse) {
                return apiResponse.message as string;
            }
            
            return JSON.stringify(apiResponse);
        } catch (error) {
            console.error("❌ Failed to parse JSON or call API:", responseText, error);
            return responseText; // Fallback to raw response
        }
    }

    private async submitCurrentAnswers(currentQuestionId?: string, currentAnswer?: string) {
        // Przygotuj odpowiedzi - wypełnij puste miejsca dla pytań bez odpowiedzi
        const answersToSubmit: Record<string, string> = {};
        
        for (const question of this.state.questions) {
            if (question.id === currentQuestionId && currentAnswer !== undefined) {
                // Użyj bieżącej odpowiedzi (jeszcze nie zapisanej w state)
                answersToSubmit[question.id] = currentAnswer;
            } else {
                // Użyj odpowiedzi z state
                const existingAnswer = this.state.answers.find(a => a.questionId === question.id);
                answersToSubmit[question.id] = existingAnswer?.message || "";
            }
        }

        console.log("\n📤 Sending answers to headquarters...", answersToSubmit);
        
        try {
            const result = await this.headquartersService.report("phone", answersToSubmit);
            console.log("✅ Response from headquarters:", result);
            
            // Check for flag in response
            if (result.message && result.message.includes('FLG:')) {
                this.state.flag = result.message;
                console.log(`🏁 FLAGA OTRZYMANA: ${result.message}`);
                // Save to cache immediately when we get the flag
                await this.saveCorrectAnswersToCache();
            }
            
            return result;
        } catch (error) {
            console.error("❌ Failed to send answers:", error);
            throw error;
        }
    }

    private async addAnswerForQuestionToState(questionId: string, answer: string): Promise<void> {
        const existingAnswerIndex = this.state.answers.findIndex(a => a.questionId === questionId);
        if (existingAnswerIndex >= 0) {
            this.state.answers[existingAnswerIndex].message = answer;
        } else {
            this.state.answers.push({ questionId: questionId, message: answer });
        }
        
        // Zapisz do cache natychmiast
        await this.saveCorrectAnswersToCache();
    }

    private async loadCorrectAnswersFromCache(): Promise<void> {
        try {
            if (await this.cacheService.fileExists('correct-answers.json')) {
                const cachedData = await this.cacheService.getOrFetchJson('correct-answers.json', async () => ({ answers: [], flag: undefined }));
                
                // Obsłuż różne formaty cache (stary format - tablica, nowy format - obiekt)
                if (Array.isArray(cachedData)) {
                    // Stary format - tylko odpowiedzi
                    this.state.answers = cachedData as Answer[];
                    this.state.flag = undefined;
                } else {
                    // Nowy format - obiekt z odpowiedziami i flagą
                    this.state.answers = cachedData.answers || [];
                    this.state.flag = cachedData.flag;
                }
                
                console.log(`📦 Loaded ${this.state.answers.length} correct answers from cache:`, this.state.answers);
                if (this.state.flag) {
                    console.log(`📦 Loaded flag from cache: ${this.state.flag}`);
                }
            } else {
                console.log("📦 No cached answers found, starting fresh");
            }
        } catch (error) {
            console.error("❌ Failed to load cached answers:", error);
            this.state.answers = [];
            this.state.flag = undefined;
        }
    }

    private async saveCorrectAnswersToCache(): Promise<void> {
        try {
            const cacheData = {
                answers: this.state.answers,
                flag: this.state.flag
            };
            await this.cacheService.writeFile('correct-answers.json', JSON.stringify(cacheData, null, 2));
            console.log(`💾 Saved ${this.state.answers.length} correct answers to cache`);
            if (this.state.flag) {
                console.log(`💾 Saved flag to cache: ${this.state.flag}`);
            }
        } catch (error) {
            console.error("❌ Failed to save answers to cache:", error);
        }
    }

    private async resubmitAnswers() {
        console.log("\n🔄 Resubmitting all answers to headquarters...");
        const result = await this.submitCurrentAnswers();
        
        if (result.code === 0) {
            console.log("✅ Answers resubmitted successfully!");
            if (this.state.flag) {
                console.log(`🏁 FLAGA: ${this.state.flag}`);
            } else {
                console.log("⚠️ Still no flag received - some answers might be incorrect");
            }
        } else {
            console.log("❌ Resubmission failed:", result.message);
        }
    }
}

