import { startSqlServer } from './dolt-server';

/**
 * Le processus qui lance un serveur d'essai, pour `dolt-server.test.ts` (bdesk-38k.44) : il annonce le port du serveur de la base `<base>` par une
 * ligne JSON sur sa sortie, puis il reste en vie jusqu'à ce qu'on le tue (`kill`) ou sort, sans avoir arrêté le serveur, dès qu'on lui écrit sur
 * son entrée (`exit`). Dans les deux cas il sort aussi quand son entrée se ferme : c'est ce que le noyau fait quand le test qui l'a lancé disparaît,
 * et sans cela le parent, son superviseur et le serveur lui survivraient. Le test vérifie que le serveur ne lui survit pas.
 *
 * Usage : `node --import tsx dolt-server-parent.ts <base> <kill|exit>`, avec l'environnement isolé de la base (`isolatedDoltEnv`).
 */
const [database, how] = process.argv.slice(2);
if (!database || (how !== 'kill' && how !== 'exit')) throw new Error('usage : dolt-server-parent.ts <base> <kill|exit>');

const server = await startSqlServer(process.env, database);
process.stdout.write(`${JSON.stringify({ port: server.port })}\n`);
// Sans attendre qu'on le tue : il sort aussi quand son entrée se ferme, c'est-à-dire quand le test qui l'a lancé disparaît (le superviseur arrête alors le serveur).
process.stdin.on('end', () => process.exit(0)).resume();
if (how === 'exit') process.stdin.once('data', () => process.exit(0));
