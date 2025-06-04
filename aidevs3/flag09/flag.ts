// Puzzle solution: "Krzyżowo, logicznie, algorytmicznie"
// Code to decode: GhU1Pj1fKTM3NCY1KsUmNxkP
// Key: ANDRZEJ (from the text)

const code = "GhU1Pj1fKTM3NCY1KsUmNxkP";
const key = "ANDRZEJ";

console.log("=== Decoding puzzle ===");
console.log("Code:", code);
console.log("Key:", key);
console.log();

// Method 1: Base64 decode first
try {
    const base64Decoded = Buffer.from(code, 'base64').toString();
    console.log("Base64 decoded:", base64Decoded);
    console.log("Base64 decoded (hex):", Buffer.from(code, 'base64').toString('hex'));
    console.log();
} catch (e) {
    console.log("Base64 decode failed");
}

// Method 2: XOR with repeating key "ANDRZEJ"
function xorWithKey(data: string, key: string): string {
    let result = '';
    for (let i = 0; i < data.length; i++) {
        const dataChar = data.charCodeAt(i);
        const keyChar = key.charCodeAt(i % key.length);
        result += String.fromCharCode(dataChar ^ keyChar);
    }
    return result;
}

// Try XOR with base64 decoded data
try {
    const base64Decoded = Buffer.from(code, 'base64').toString('binary');
    const xorResult = xorWithKey(base64Decoded, key);
    console.log("XOR result (from base64):", xorResult);
    console.log("XOR result (readable):", xorResult.replace(/[^\x20-\x7E]/g, ''));
    console.log();
} catch (e) {
    console.log("XOR with base64 failed");
}

// Method 3: Try XOR directly on the code
const xorDirect = xorWithKey(code, key);
console.log("XOR direct on code:", xorDirect);
console.log();

// Method 4: Vigenère cipher
function vigenereDecrypt(text: string, key: string): string {
    let result = '';
    let keyIndex = 0;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        if (char.match(/[a-zA-Z]/)) {
            const isUpperCase = char === char.toUpperCase();
            const charCode = char.toUpperCase().charCodeAt(0) - 65;
            const keyChar = key[keyIndex % key.length].toUpperCase().charCodeAt(0) - 65;
            
            let decryptedCode = (charCode - keyChar + 26) % 26;
            let decryptedChar = String.fromCharCode(decryptedCode + 65);
            
            result += isUpperCase ? decryptedChar : decryptedChar.toLowerCase();
            keyIndex++;
        } else {
            result += char;
        }
    }
    
    return result;
}

console.log("Vigenère decrypt:", vigenereDecrypt(code, key));
console.log();

// Method 5: Caesar cipher with different shifts
for (let shift = 1; shift <= 25; shift++) {
    let caesarResult = '';
    for (let i = 0; i < code.length; i++) {
        const char = code[i];
        if (char.match(/[a-zA-Z]/)) {
            const isUpperCase = char === char.toUpperCase();
            const charCode = char.toUpperCase().charCodeAt(0);
            let shiftedCode = ((charCode - 65 - shift + 26) % 26) + 65;
            let shiftedChar = String.fromCharCode(shiftedCode);
            caesarResult += isUpperCase ? shiftedChar : shiftedChar.toLowerCase();
        } else {
            caesarResult += char;
        }
    }
    
    if (caesarResult.includes('FLAG') || caesarResult.includes('flag')) {
        console.log(`Caesar shift ${shift}:`, caesarResult);
    }
}

// Method 6: Try interpreting as hex and then XOR
try {
    // Convert to hex first, then XOR
    const hexData = Buffer.from(code, 'base64').toString('hex');
    console.log("Hex data:", hexData);
    
    // Convert hex back to binary and XOR
    const binaryFromHex = Buffer.from(hexData, 'hex').toString('binary');
    const xorFromHex = xorWithKey(binaryFromHex, key);
    console.log("XOR from hex:", xorFromHex);
} catch (e) {
    console.log("Hex method failed");
}

console.log("\n=== Analysis complete ===");
