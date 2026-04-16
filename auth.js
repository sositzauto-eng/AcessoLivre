import { 
    auth, db, provider, signInWithPopup, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    signOut, doc, setDoc, getDoc 
} from './firebase-config.js';

export const AuthService = {
    // Exportamos o auth para o app.js usar nos listeners
    auth: auth,

    // Entrar com Google (O ponto crítico)
    async loginWithGoogle() {
        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const userRef = doc(db, "usuarios", user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    nome: user.displayName,
                    email: user.email,
                    score: 500,
                    nivel: "Iniciante",
                    criadoEm: new Date().toISOString()
                });
            }
            return user;
        } catch (error) {
            console.error("Erro no Google Login:", error.code);
            throw error;
        }
    },

    // Criar Nova Conta E-mail/Senha
    async signUp(email, password, name) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await setDoc(doc(db, "usuarios", user.uid), {
            nome: name,
            email: email,
            score: 500,
            nivel: "Iniciante",
            criadoEm: new Date().toISOString()
        });
        return user;
    },

    // Entrar com E-mail e Senha
    async login(email, password) {
        return await signInWithEmailAndPassword(auth, email, password);
    },

    // Sair
    async logout() {
        return await signOut(auth);
    }
};
