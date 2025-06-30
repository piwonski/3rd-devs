export class UnicodeUtils {
    
    decodeUnicode(obj: any): any {
        if (typeof obj === 'string') {
            return obj.replace(/\\u[\dA-F]{4}/gi, (match) => 
                String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))
            );
        }
        return obj;
    }
}