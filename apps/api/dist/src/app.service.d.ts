export declare class AppService {
    getServiceInfo(): {
        name: string;
        status: string;
        version: string;
        time: string;
        endpoints: {
            health: string;
            auth: string;
            onboarding: string;
            contacts: string;
            match_engine: string;
            sandbox: string;
            admin: string;
        };
    };
}
