// Le serveur vit à l'heure de Paris, comme l'équipe.
//
// Railway démarre le processus en UTC. Toutes les règles « aujourd'hui », « ce rendez-vous
// est passé », « cette semaine » (shared/regles.js) lisent l'heure du processus : en UTC,
// un compte rendu était refusé pendant les deux heures suivant le rendez-vous, un appel
// passé à minuit et demi tombait sur la veille, et le lundi avant deux heures l'IA parlait
// de la semaine d'avant. Ce fichier est importé en tout premier par server.js : Node
// relit TZ à chaque appel de Date, le réglage vaut donc pour tout ce qui suit.
process.env.TZ = 'Europe/Paris';
