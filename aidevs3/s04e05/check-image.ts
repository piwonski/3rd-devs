import { OpenAIService } from '../shared/OpenAIService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import * as fs from 'fs';
import * as path from 'path';

async function checkImage() {
    const expenseCounter = new ExpenseCounter();
    const openaiService = new OpenAIService(3072, expenseCounter);
    
    const imagePath = path.join(__dirname, 'cache', 'page19.png');
    const base64Image = fs.readFileSync(imagePath, 'base64');
    
    console.log('🔍 Analiza kartek na stronie 19...');
    
    const prompt = `Przeanalizuj ten obraz strony 19 z notatnika Rafała.

KRYTYCZNE INFORMACJE:
- Na obrazie są różne kawałki papieru przyklejone taśmą
- Pytanie: "Gdzie się chce dostać Rafał po spotkaniu z Andrzejem?"
- Centrala mówi: "Informacja do znalezienia na ostatniej stronie PDF-a, ale to nie tekst, a obraz!"
- WAŻNE: Nazwa miejsca może być ROZBITA MIĘDZY KARTKAMI!

ZADANIE:
1. Zidentyfikuj wszystkie kawałki papieru/kartki na obrazie
2. Przeczytaj tekst na każdej kartce osobno
3. NAJWAŻNIEJSZE: Spróbuj "złożyć" fragmenty tekstu z różnych kartek w logiczną całość
4. Szukaj nazwy miejsca która może być podzielona między kartkami (np. "Lu" na jednej kartce + "bawa" na drugiej)
5. Zwróć szczególną uwagę na fragmenty związane ze spotkaniem z Andrzejem

METODA:
- Przeczytaj każdą kartkę
- Sprawdź czy fragmenty tekstu z sąsiadujących kartek mogą tworzyć nazwę miejsca
- Szczególnie szukaj kontekstu "dostać się do..." lub podobnego

Podaj mi:
1. Tekst z każdej kartki osobno
2. Próby połączenia fragmentów między kartkami  
3. Końcową nazwę miejsca gdzie Rafał chce się dostać`;

    try {
        const result = await openaiService.processImage(imagePath, prompt);
        console.log('🎯 Analiza połączonych kartek:');
        console.log('Description:', result.description);
        
        // Display costs
        const tokens = expenseCounter.getUsedTokens();
        const costs = expenseCounter.getEstimatedCost('gpt-4o');
        console.log('\n💰 Koszt analizy:');
        console.log(`Estimated cost: $${costs.totalCost.toFixed(4)} USD`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

checkImage().catch(console.error); 