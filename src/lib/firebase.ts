import { initializeApp } from 'firebase/app';
        import { getAuth } from 'firebase/auth';
        import { getFirestore } from 'firebase/firestore';

        export const firebaseConfig = {
  "apiKey": "AIzaSyCpLXgaUEeNSyUEMKXXTeZcQRB85dvmUv4",
  "authDomain": "site-pm-guiasys.firebaseapp.com",
  "projectId": "site-pm-guiasys",
  "storageBucket": "site-pm-guiasys.firebasestorage.app",
  "messagingSenderId": "487245114742",
  "appId": "1:487245114742:web:9abf29f233757f2c64de57",
  "measurementId": "G-6EVN6MNYLR"
};

        export const app = initializeApp(firebaseConfig);
        export const auth = getAuth(app);
        export const db = getFirestore(app);
