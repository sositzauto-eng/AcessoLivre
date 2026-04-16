import { 
    auth, db, provider, signInWithPopup, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    signOut, onAuthStateChanged, doc, setDoc, getDoc 
} from './firebase-config.js';

export const AuthService = {
    auth: auth,

    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, callback);
    },

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

    async login(email, password) {
        return await signInWithEmailAndPassword(auth, email, password);
    },

    async logout() {
        return await signOut(auth);
    }
};
