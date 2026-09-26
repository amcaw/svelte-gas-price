const DEPOT = 'amcaw/svelte-gas-price';
const WORKFLOW = 'update-prices.yml';
const HEURE_BRUXELLES = 10;
const CRONS_HORAIRES = ['0 8 * * *', '0 9 * * *'];

function heureBruxelles(date) {
    const parties = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Brussels',
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    return Number(parties.find((p) => p.type === 'hour').value);
}

async function lancerWorkflow(jeton) {
    const reponse = await fetch(
        `https://api.github.com/repos/${DEPOT}/actions/workflows/${WORKFLOW}/dispatches`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jeton}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'svelte-gas-price-spf',
            },
            body: JSON.stringify({ ref: 'main' }),
        },
    );
    if (!reponse.ok) {
        throw new Error(`GitHub a répondu ${reponse.status} : ${await reponse.text()}`);
    }
}

export default {
    async scheduled(controller, env) {
        const horaire = CRONS_HORAIRES.includes(controller.cron);
        if (horaire && heureBruxelles(new Date(controller.scheduledTime)) !== HEURE_BRUXELLES) {
            return;
        }
        await lancerWorkflow(env.GITHUB_TOKEN);
        console.log(`Workflow ${WORKFLOW} lancé (cron ${controller.cron})`);
    },
};
