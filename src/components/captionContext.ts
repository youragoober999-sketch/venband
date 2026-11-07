// Lets a picture or GIF inside a message offer "Caption" in its right-click
// menu: the message provides what to do (reply to it and start /caption).
import { createContext, useContext } from 'react';

export const CaptionContext = createContext<(() => void) | null>(null);
export const useCaptionAction = () => useContext(CaptionContext);
