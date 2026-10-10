import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

// StrictMode 의 개발용 이중 effect 실행은 카메라를 중복으로 열 수 있어 사용하지 않는다.
createRoot(document.getElementById('root')!).render(<App />);
