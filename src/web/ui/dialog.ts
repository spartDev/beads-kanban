/** Habillage commun des boîtes de dialogue (palette, aide des raccourcis). */
export const dialogOverlay =
  'fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-[overlay-in_120ms_ease-out] data-[state=closed]:animate-[overlay-out_90ms_ease-in]';

export const dialogSurface =
  'fixed inset-x-3 top-3 z-50 mx-auto max-w-[640px] overflow-hidden rounded-[14px] bg-float text-ink shadow-float outline-none data-[state=open]:animate-[palette-in_140ms_cubic-bezier(0.2,0.8,0.2,1)] data-[state=closed]:animate-[palette-out_90ms_ease-in] md:top-[12vh]';
