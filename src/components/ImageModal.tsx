'use client'

import { useState, useEffect } from 'react';

interface ImageModalProps {
  src: string;
  alt: string;
  title: string;
  description: string;
}

export const ImageModal = ({ src, alt, title, description }: ImageModalProps) => {
  const [isOpen, setIsOpen] = useState(false);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  return (
    <>
      {/* Thumbnail/Preview - click to open */}
      <div 
        className="cursor-pointer group relative"
        onClick={() => setIsOpen(true)}
      >
        <img 
          src={src} 
          alt={alt} 
          className="max-w-full h-auto object-contain rounded-md transition-transform group-hover:scale-105"
        />
        {/* Overlay hint */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 rounded-md flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
            <p className="text-white font-semibold mt-2">Click to enlarge</p>
          </div>
        </div>
      </div>

      {/* Modal */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 animate-fade-in backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
          style={{ paddingTop: '80px' }}
        >
          <div className="relative w-full h-full max-w-[98vw] max-h-[90vh] flex items-center justify-center">
            {/* Close button - Prominent X in top-right corner */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 bg-red-500/90 hover:bg-red-600 text-white rounded-full p-3 transition-all duration-200 shadow-lg hover:scale-110 z-10"
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Modal content */}
            <div 
              className="bg-white rounded-2xl shadow-2xl overflow-hidden border-2 border-gray-300 max-w-full max-h-full flex flex-col"
              onClick={(e) => e.stopPropagation()}
              style={{ maxHeight: 'calc(90vh - 80px)', maxWidth: '95vw' }}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)] px-6 py-4">
                <h3 className="text-2xl font-bold text-[var(--accent-on-primary)]">{title}</h3>
                <p className="mt-1 text-sm text-[var(--accent-on-primary)] opacity-85">{description}</p>
              </div>

              {/* Image - scrollable container */}
              <div className="flex flex-1 items-center justify-center overflow-auto bg-[var(--card-bg)] p-6">
                <img
                  src={src}
                  alt={alt}
                  className="h-auto w-full object-contain"
                  style={{ maxHeight: 'calc(90vh - 220px)' }}
                />
              </div>

              {/* Footer */}
              <div className="border-t border-[var(--border-color)] bg-[var(--muted-bg)] px-6 py-3 text-center">
                <p className="text-sm text-[var(--text-secondary)]">
                  Press <kbd className="rounded border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]">ESC</kbd> or click outside to close
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
