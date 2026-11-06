// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): traduções das salas temáticas e do "ir e fazer"
// (client/src/kaviski/plan/themes*.ts e go-and-do.ts). Uma linha por texto: [pt, en, es, fr]. Entram nos dicionários
// com `...KV_TEMAS_XX` em en.ts, es.ts e fr.ts.
const T: readonly (readonly [string, string, string, string])[] = [
  // ---- salas temáticas (themes-info.ts)
  ['RH', 'HR', 'RR. HH.', 'RH'],
  ['Pessoas: contas, convites e registro; organograma na parede', 'People: accounts, invites and log; org chart on the wall', 'Personas: cuentas, invitaciones y registro; organigrama en la pared', 'Personnes : comptes, invitations et journal ; organigramme au mur'],
  ['Diretoria', 'Board room', 'Dirección', 'Direction'],
  ['Organograma grande e a luneta da visão geral do prédio', 'Big org chart and the telescope for the building overview', 'Organigrama grande y el catalejo de la vista general del edificio', 'Grand organigramme et la longue-vue de la vue d’ensemble'],
  ['Sala de reunião', 'Meeting room', 'Sala de reuniones', 'Salle de réunion'],
  ['Mesa grande, telão e o calendário da agenda', 'Big table, screen and the calendar', 'Mesa grande, pantalla y el calendario de la agenda', 'Grande table, écran et le calendrier de l’agenda'],
  ['Recepção de visitantes', 'Visitor reception', 'Recepción de visitantes', 'Accueil des visiteurs'],
  ['Balcão de convites, quadro de presença, mapa e informações', 'Invite desk, presence board, map and information', 'Mostrador de invitaciones, tablero de presencia, mapa e información', 'Comptoir des invitations, tableau de présence, plan et informations'],
  ['Provador', 'Fitting room', 'Probador', 'Cabine d’essayage'],
  ['Espelho para trocar a aparência do boneco e o crachá', 'Mirror to change your character’s look and badge', 'Espejo para cambiar el aspecto del muñeco y la credencial', 'Miroir pour changer l’apparence du personnage et le badge'],
  ['Cabines de foco', 'Focus booths', 'Cabinas de concentración', 'Cabines de concentration'],
  ['Cabines silenciosas com o relógio do pomodoro', 'Quiet booths with the pomodoro timer', 'Cabinas silenciosas con el reloj pomodoro', 'Cabines silencieuses avec le minuteur pomodoro'],
  ['Auditório', 'Auditorium', 'Auditorio', 'Auditorium'],
  ['Palco com púlpito: falar para o andar inteiro', 'Stage with a podium: speak to the whole floor', 'Escenario con atril: hablar a toda la planta', 'Scène avec pupitre : parler à tout l’étage'],
  ['Central dos agentes', 'Agent hub', 'Central de agentes', 'Centrale des agents'],
  ['Novo agente no terminal, timelapse na TV, meu dia e histórico', 'New agent at the terminal, timelapse on the TV, my day and history', 'Nuevo agente en el terminal, timelapse en la TV, mi día e historial', 'Nouvel agent au terminal, timelapse sur la télé, ma journée et historique'],
  ['TI e ajustes', 'IT and settings', 'TI y ajustes', 'Informatique et réglages'],
  ['Avisos, atalhos, voz e vídeo e configurações', 'Alerts, shortcuts, voice and video and settings', 'Avisos, atajos, voz y vídeo y configuración', 'Alertes, raccourcis, voix et vidéo et réglages'],
  ['Arquitetura', 'Architecture', 'Arquitectura', 'Architecture'],
  ['A maquete da empresa: editar a planta e as salas', 'The company model: edit the floor plan and the rooms', 'La maqueta de la empresa: editar la planta y las salas', 'La maquette de l’entreprise : modifier le plan et les salles'],
  ['Correio', 'Mailroom', 'Correo', 'Courrier'],
  ['Caixa de correio das conversas e o escaninho das entregas', 'Mailbox for conversations and the deliveries pigeonholes', 'Buzón de las conversaciones y el casillero de las entregas', 'Boîte aux lettres des conversations et casiers des livraisons'],
  ['Sala de descanso', 'Break room', 'Sala de descanso', 'Salle de repos'],
  ['Rede para o modo clássico, fliperama e sofás', 'Hammock for classic mode, arcade and sofas', 'Hamaca para el modo clásico, máquina recreativa y sofás', 'Hamac pour le mode classique, borne d’arcade et canapés'],
];

function dict(i: 1 | 2 | 3): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const row of T) out[row[0]] = row[i];
  return out;
}

export const KV_TEMAS_EN = dict(1);
export const KV_TEMAS_ES = dict(2);
export const KV_TEMAS_FR = dict(3);
