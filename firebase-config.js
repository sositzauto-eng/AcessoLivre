import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc,
    getDocs,
    collection,
    query,
    orderBy,
    updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcThtAGaLFpObMWZKpnlS3NZwb1YOWC00",
  authDomain: "sosweb-85603.firebaseapp.com",
  projectId: "sosweb-85603",
  storageBucket: "sosweb-85603.firebasestorage.app",
  messagingSenderId: "493039677510",
  appId: "1:493039677510:web:851cb36b68b6203650da47",
  measurementId: "G-QC29XGWNCN"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export { 
    auth, db, provider,
    signInWithPopup, onAuthStateChanged, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    signOut,
    doc, setDoc, getDoc, getDocs, collection, query, orderBy, updateDoc
};
