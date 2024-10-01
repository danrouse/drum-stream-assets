import { useState, useEffect } from 'react';
import './style.css';

async function submitDownloadQuery(q: string, socket: WebSocket) {
  socket.send(JSON.stringify({
    type: 'song_request',
    query: q,
  }));
  // await fetch('/stem', {
  //   body: JSON.stringify({ q }),
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  // });
}

interface DownloaderProps {
  onDownloadComplete: () => void;
  onInputChanged: (q: string) => void;
  socket: WebSocket;
  value?: string;
}

export default function Downloader({ onDownloadComplete, onInputChanged, socket, value }: DownloaderProps) {
  const [searchQuery, setSearchQuery] = useState(value || '');
  const [processingState, setProcessingState] = useState<string | undefined>('');

  const clearInput = () => {
    setSearchQuery('');
    onInputChanged('');
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const message: WebSocketServerMessage = JSON.parse(e.data.toString());
      if (!message) return;
      if (message.type === 'download_start') {
        setProcessingState(`Attempting to download "${message.query}"`);
      } else if (message.type === 'download_complete') {
        setProcessingState(`Downloaded "${message.name}"`);
      } else if (message.type === 'demucs_start') {
        setProcessingState(`Calling demucs on ${message.name}`);
      } else if (message.type === 'demucs_progress') {
        if (message.progress < 1) {
          setProcessingState(`Demucs progress on ${message.name}: ${Math.round(message.progress * 10000) / 100}%`);
        } else {
          setProcessingState(`Demucs doing final processing and cleanup on ${message.name}`);
        }
      } else if (message.type === 'demucs_complete') {
        setProcessingState(undefined);
        onDownloadComplete();
      } else if (message.type === 'demucs_error') {
        setProcessingState(`Demucs error: ${message.message}`);
      }
    };
    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="Downloader">
      <form onSubmit={(event) => {
        event.preventDefault();
        try {
          submitDownloadQuery(searchQuery, socket);
          setProcessingState(`Submitted request for ${searchQuery}`);
        } catch (err) {
          setProcessingState(`Error while processing ${searchQuery}: ` + err);
        }
        clearInput();
      }}>
        <button onClick={() => clearInput()} type="reset">
          <i className="fa-solid fa-xmark" />
        </button>
        <input
          type="text"
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.currentTarget.value);
            onInputChanged(e.currentTarget.value);
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Find a song"
        />
        <button type="submit">Begin Processing</button>
      </form>
      {processingState && <div className="Downloader__status"><p>{processingState}</p></div>}
    </div>
  );
}
