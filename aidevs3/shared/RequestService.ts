export class RequestService {

    async post<Body, Response>(url: string, body: Body) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return data as Response;
    }

    async get<Response>(url: string) {
        const response = await fetch(url);
        const data = await response.json();
        return data as Response;
    }

}