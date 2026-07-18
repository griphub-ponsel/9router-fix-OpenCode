import { createPortal } from 'react-dom';

export default function Head({ children }) {
  return createPortal(children, document.head);
}
