export function makePDF({title='Urban airspace risk and safety analysis',embeddedTitle=title,doi='10.1234/paperdesk.fixture',authors='A Researcher; B Researcher',venue='Journal of UAV Safety'}={}){
 const escape=s=>s.replace(/[\\()]/g,'\\$&');
 const content=`BT /F1 20 Tf 50 750 Td (${escape(title)}) Tj /F1 12 Tf 0 -40 Td (${escape(venue)}) Tj 0 -30 Td (DOI: ${escape(doi)}) Tj 0 -30 Td (Published 2026) Tj ET`;
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  `<< /Title (${escape(embeddedTitle)}) /Author (${escape(authors)}) /Subject (doi:${escape(doi)}) >>`
 ];let pdf='%PDF-1.4\n',offsets=[0];for(const [i,object] of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new TextEncoder().encode(pdf);
}
