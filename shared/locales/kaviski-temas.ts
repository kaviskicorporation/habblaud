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
  ['Espelho para trocar a aparência do avatar e o crachá', 'Mirror to change your avatar’s look and badge', 'Espejo para cambiar el aspecto del avatar y la credencial', 'Miroir pour changer l’apparence de l’avatar et le badge'],
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
  // ---- "ir e fazer" (go-and-do.ts, themes-actions.ts)
  ['Indo até {0}…', 'Going to {0}…', 'Yendo a {0}…', 'En route vers {0}…'],
  ['Esc cancela', 'Esc cancels', 'Esc cancela', 'Échap annule'],
  ['Mini-mapa', 'Mini-map', 'Minimapa', 'Mini-carte'],
  ['Ajuda', 'Help', 'Ayuda', 'Aide'],
  ['Palco (megafone)', 'Stage (megaphone)', 'Escenario (megáfono)', 'Scène (mégaphone)'],
  ['Atalhos', 'Shortcuts', 'Atajos', 'Raccourcis'],
  ['Ajustes de voz e vídeo', 'Voice and video settings', 'Ajustes de voz y vídeo', 'Réglages voix et vidéo'],
  ['Organograma', 'Org chart', 'Organigrama', 'Organigramme'],
  ['Modo clássico (descansar)', 'Classic mode (rest)', 'Modo clásico (descansar)', 'Mode classique (se reposer)'],
  // ---- "ir e fazer": configuração "Abrir só ao chegar ao local" (go-and-do.ts, humanos/prefs.ts, server/kaviski/humanos/prefs.ts)
  ['Ir e fazer', 'Go and do', 'Ir y hacer', 'Aller et faire'],
  ['Abrir só ao chegar ao local', 'Open only on arrival at the spot', 'Abrir solo al llegar al lugar', 'Ouvrir seulement à l’arrivée sur place'],
  ['Abrir só ao chegar ao local: ligado', 'Open only on arrival at the spot: on', 'Abrir solo al llegar al lugar: activado', 'Ouvrir seulement à l’arrivée sur place : activé'],
  ['Abrir só ao chegar ao local: desligado (a janela abre na hora e o avatar vai até lá)', 'Open only on arrival at the spot: off (the window opens right away and the avatar walks there)', 'Abrir solo al llegar al lugar: desactivado (la ventana se abre al instante y el avatar va hasta allí)', 'Ouvrir seulement à l’arrivée sur place : désactivé (la fenêtre s’ouvre tout de suite et l’avatar y va)'],
  ['Ligado: ao clicar num botão do topo, o seu avatar caminha até o lugar da função e a janela só abre quando ele chega. Desligado: a janela abre na hora e o avatar vai até lá; fechar a janela antes de ele chegar faz ele parar. Shift+clique abre sem andar.', 'On: when you click a top bar button, your avatar walks to that feature’s spot and the window only opens when it gets there. Off: the window opens right away and the avatar walks there anyway; closing the window before it arrives makes it stop. Shift+click opens without walking.', 'Activado: al hacer clic en un botón de la barra superior, tu avatar camina hasta el lugar de la función y la ventana solo se abre cuando llega. Desactivado: la ventana se abre al instante y el avatar camina hasta allí; cerrar la ventana antes de que llegue lo detiene. Mayús+clic abre sin caminar.', 'Activé : en cliquant sur un bouton de la barre du haut, votre avatar marche jusqu’à l’endroit de la fonction et la fenêtre ne s’ouvre qu’à son arrivée. Désactivé : la fenêtre s’ouvre tout de suite et l’avatar y va quand même ; fermer la fenêtre avant son arrivée l’arrête. Maj+clic ouvre sans marcher.'],
  ['Ligado: o seu avatar caminha até o lugar da função e a janela só abre quando ele chega. Desligado: a janela abre na hora e o avatar vai junto (Shift+clique abre sem andar)', 'On: your avatar walks to the feature’s spot and the window only opens when it arrives. Off: the window opens right away and the avatar walks there too (Shift+click opens without walking)', 'Activado: tu avatar camina hasta el lugar de la función y la ventana solo se abre cuando llega. Desactivado: la ventana se abre al instante y el avatar va también (Mayús+clic abre sin caminar)', 'Activé : votre avatar marche jusqu’à l’endroit de la fonction et la fenêtre ne s’ouvre qu’à son arrivée. Désactivé : la fenêtre s’ouvre tout de suite et l’avatar y va aussi (Maj+clic ouvre sans marcher)'],
  ['🚶 Abrir ao chegar: ligado', '🚶 Open on arrival: on', '🚶 Abrir al llegar: activado', '🚶 Ouvrir à l’arrivée : activé'],
  ['🚶 Abrir ao chegar: desligado', '🚶 Open on arrival: off', '🚶 Abrir al llegar: desactivado', '🚶 Ouvrir à l’arrivée : désactivé'],
  ['Fica salvo na sua conta (vale em qualquer navegador).', 'Saved to your account (works in any browser).', 'Se guarda en tu cuenta (vale en cualquier navegador).', 'Enregistré dans votre compte (valable dans n’importe quel navigateur).'],
  ['Fica salvo neste navegador.', 'Saved in this browser.', 'Se guarda en este navegador.', 'Enregistré dans ce navigateur.'],
  ['Não deu para salvar na sua conta; ficou só neste navegador', 'Couldn’t save to your account; kept in this browser only', 'No se pudo guardar en tu cuenta; quedó solo en este navegador', 'Impossible d’enregistrer dans votre compte ; gardé seulement dans ce navigateur'],
  ['entre com a sua conta para salvar as preferências', 'sign in with your account to save preferences', 'inicia sesión con tu cuenta para guardar las preferencias', 'connectez-vous à votre compte pour enregistrer les préférences'],
  ['preferência inválida', 'invalid preference', 'preferencia no válida', 'préférence invalide'],
];

function dict(i: 1 | 2 | 3): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const row of T) out[row[0]] = row[i];
  return out;
}

export const KV_TEMAS_EN = dict(1);
export const KV_TEMAS_ES = dict(2);
export const KV_TEMAS_FR = dict(3);
