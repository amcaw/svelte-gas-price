const DEPOT = 'amcaw/svelte-gas-price';
const CRON_HORAIRE = '0 * * * *';
const WORKFLOWS_PAR_HEURE = {
    8: ['update-best-prices.yml'],
    10: ['update-prices.yml', 'update-best-prices.yml'],
    17: ['update-best-prices.yml'],
};

function heureBruxelles(date) {
    const parties = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Brussels',
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    return Number(parties.find((p) => p.type === 'hour').value);
}

function workflowsALancer(cron, date) {
    if (cron !== CRON_HORAIRE) {
        return [...new Set(Object.values(WORKFLOWS_PAR_HEURE).flat())];
    }
    return WORKFLOWS_PAR_HEURE[heureBruxelles(date)] ?? [];
}

async function lancerWorkflow(workflow, jeton) {
    const reponse = await fetch(
        `https://api.github.com/repos/${DEPOT}/actions/workflows/${workflow}/dispatches`,
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
        throw new Error(`${workflow} : GitHub a répondu ${reponse.status} : ${await reponse.text()}`);
    }
    console.log(`Workflow ${workflow} lancé`);
}

export default {
    async scheduled(controller, env) {
        const workflows = workflowsALancer(controller.cron, new Date(controller.scheduledTime));
        const resultats = await Promise.allSettled(
            workflows.map((workflow) => lancerWorkflow(workflow, env.GITHUB_TOKEN)),
        );
        const echecs = resultats.filter((r) => r.status === 'rejected');
        if (echecs.length) {
            throw new Error(echecs.map((r) => r.reason.message).join('\n'));
        }
    },
};
