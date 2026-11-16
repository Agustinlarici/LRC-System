import { redirect } from 'next/navigation';

// Nome precedente della pagina (Photo Station): i segnalibri esistenti continuano a funzionare.
export default function OldPhotoStationPage() {
  redirect('/quality-control-station');
}
