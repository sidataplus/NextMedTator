// Share only public-fixture measurements, never records or a user's note text.
export function conformanceSummary(report){
    const finite=value=>Number.isFinite(value)?value:null;
    return {pass:report.pass===true,backend:report.backend,precision:report.precision,manifestHash:report.manifestHash,variantId:report.variantId,
        fixtures:(report.results??[]).slice(0,100).map(row=>({fixture:row.fixture,pass:row.pass===true,
            ...(row.nativeChecks?{records:{pass:row.nativeChecks.pass===true,reason:row.nativeChecks.reason??null,
                spans:row.nativeChecks.spans??null,expectedSpans:row.nativeChecks.expectedSpans??null,actualSpans:row.nativeChecks.actualSpans??null,
                maxScoreError:finite(row.nativeChecks.maxScoreError),tolerance:finite(row.nativeChecks.tolerance)}}:{}),
            ...(row.encodedTokensMatch!==undefined?{encodedTokensMatch:row.encodedTokensMatch}:{}),
            ...(row.checks?{tensors:Object.fromEntries(Object.entries(row.checks).slice(0,32).map(([name,c])=>[name,{pass:c.pass===true,mismatches:c.mismatches??null,maxAbsoluteError:finite(c.maxAbsoluteError),atol:finite(c.atol),rtol:finite(c.rtol)}]))}:{})}))};
}
export function conformanceMessage(summary){
    if(summary.pass)return 'GPU reference checks passed on this device.';
    const failed=summary.fixtures.filter(row=>!row.pass);
    if(!failed.length)return 'Selected backend failed its public conformance fixtures.';
    const reasons=failed.map(row=>{
        const c=row.records;
        if(c?.reason==='confidence-scores-differ')return `${row.fixture}: spans and attributes match; maximum confidence difference ${c.maxScoreError?.toPrecision(4)} exceeds ${c.tolerance}`;
        if(c?.reason==='entity-spans-differ')return `${row.fixture}: predicted spans differ (${c.expectedSpans} expected, ${c.actualSpans} actual)`;
        if(c?.reason==='attribute-values-or-presence-differ')return `${row.fixture}: predicted attributes differ`;
        if(c?.reason==='non-finite-score')return `${row.fixture}: non-finite confidence scores`;
        if(row.encodedTokensMatch===false)return `${row.fixture}: token counts differ`;
        return `${row.fixture}: tensor/reference outputs differ`;
    });
    return `Model conformance checks failed. ${reasons.slice(0,4).join('; ')}.`;
}
