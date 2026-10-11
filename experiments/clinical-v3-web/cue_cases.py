"""Predeclared, synthetic clinical cue-localization cases; no PHI or external data.

Distinct wording and scope challenges; not a clinical validation dataset.
Cue annotations are span lists, allowing multiword/alternative evidence.
"""
LABELS={'assertion':['affirmed','negated','uncertain'],'temporality':['current','historical','future'],'experiencer':['patient','family','other']}

ASSERTION=[
('Patient denies suicidal ideation today.','suicidal ideation','negated',['denies']),
('No fever was noted overnight.','fever','negated',['No']),
('There is no evidence of pneumonia.','pneumonia','negated',['no evidence']),
('The patient is without agitation.','agitation','negated',['without']),
('She reports no chest pain.','chest pain','negated',['no']),
('He does not have hallucinations.','hallucinations','negated',['not']),
('Examination is negative for edema.','edema','negated',['negative for']),
('Cough is absent on assessment.','Cough','negated',['absent']),
('There are no signs of infection.','infection','negated',['no signs']),
('The patient remains free of seizures.','seizures','negated',['free of']),
('She explicitly denies hearing voices.','hearing voices','negated',['denies']),
('Shortness of breath was not reported.','Shortness of breath','negated',['not']),
('No vomiting since admission.','vomiting','negated',['No']),
('The examination found neither tremor nor rigidity.','tremor','negated',['neither']),
('Headache has resolved completely.','Headache','negated',['resolved']),
('There is no current bleeding.','bleeding','negated',['no']),
('Patient may have hallucinations at night.','hallucinations','uncertain',['may']),
('Possible pneumonia is being evaluated.','pneumonia','uncertain',['Possible']),
('The clinician suspects delirium.','delirium','uncertain',['suspects']),
('There is concern for a pulmonary embolism.','pulmonary embolism','uncertain',['concern for']),
('An infection cannot be excluded.','infection','uncertain',['cannot be excluded']),
('Chest pain might reflect ischemia.','ischemia','uncertain',['might']),
('Findings are suggestive of heart failure.','heart failure','uncertain',['suggestive of']),
('It is unclear whether seizures occurred.','seizures','uncertain',['unclear whether']),
('The differential includes meningitis.','meningitis','uncertain',['differential includes']),
('Probable depression requires further assessment.','depression','uncertain',['Probable']),
('Rule out appendicitis before discharge.','appendicitis','uncertain',['Rule out']),
('There could be an underlying arrhythmia.','arrhythmia','uncertain',['could']),
('Patient reports suicidal ideation today.','suicidal ideation','affirmed',['reports']),
('Fever is present on examination.','Fever','affirmed',['present']),
('He endorses persistent chest pain.','chest pain','affirmed',['endorses']),
('Examination confirms bilateral edema.','edema','affirmed',['confirms']),
('The patient has an active cough.','cough','affirmed',['has','active']),
('She describes recurrent headaches.','headaches','affirmed',['describes']),
('Hallucinations were observed by nursing staff.','Hallucinations','affirmed',['observed']),
('Bleeding continues despite pressure.','Bleeding','affirmed',['continues']),
('The patient complains of nausea.','nausea','affirmed',['complains of']),
('A seizure was witnessed overnight.','seizure','affirmed',['witnessed']),
('The examination demonstrates tremor.','tremor','affirmed',['demonstrates']),
('Pneumonia was confirmed on imaging.','Pneumonia','affirmed',['confirmed']),
('Patient denies hallucinations but reports agitation today.','agitation','affirmed',['reports']),
('Patient denies hallucinations but reports agitation today.','hallucinations','negated',['denies']),
('No fever, but a persistent cough is present.','cough','affirmed',['present']),
('No fever, but a persistent cough is present.','fever','negated',['No']),
('Chest pain is present without shortness of breath.','Chest pain','affirmed',['present']),
('Chest pain is present without shortness of breath.','shortness of breath','negated',['without']),
('Possible delirium, although hallucinations are clearly absent.','delirium','uncertain',['Possible']),
('Possible delirium, although hallucinations are clearly absent.','hallucinations','negated',['absent']),
]

TEMPORALITY=[
('The patient had agitation last year.','agitation','historical',['last year']),
('A history of seizures was documented.','seizures','historical',['history of']),
('She experienced depression during adolescence.','depression','historical',['during adolescence']),
('Pneumonia occurred three months ago.','Pneumonia','historical',['three months ago']),
('There was prior chest pain before admission.','chest pain','historical',['prior','before admission']),
('The headache resolved yesterday.','headache','historical',['resolved yesterday']),
('He previously had an episode of delirium.','delirium','historical',['previously']),
('Remote childhood asthma was noted.','asthma','historical',['Remote childhood']),
('The patient currently has agitation.','agitation','current',['currently']),
('Fever is present today.','Fever','current',['today']),
('She reports chest pain right now.','chest pain','current',['right now']),
('Headache continues at this visit.','Headache','current',['continues','this visit']),
('He is experiencing active nausea.','nausea','current',['is experiencing','active']),
('Current symptoms include dizziness.','dizziness','current',['Current']),
('Hallucinations are ongoing this morning.','Hallucinations','current',['ongoing','this morning']),
('There is bleeding at present.','bleeding','current',['at present']),
('Nausea is expected after tomorrow\'s chemotherapy.','Nausea','future',['expected','tomorrow']),
('The clinician anticipates postoperative pain tomorrow.','pain','future',['anticipates','tomorrow']),
('Monitor for fever during the coming week.','fever','future',['coming week']),
('Seizures could occur after medication withdrawal next month.','Seizures','future',['next month']),
('The team expects delirium after the upcoming operation.','delirium','future',['expects','upcoming']),
('She may develop edema in the next few days.','edema','future',['next few days']),
('A future recurrence of depression is possible.','depression','future',['future recurrence']),
('Potential bleeding tomorrow will require monitoring.','bleeding','future',['tomorrow']),
]

EXPERIENCER=[
('The mother has depression; the patient feels well.','depression','family',['mother']),
('His father was diagnosed with dementia.','dementia','family',['father']),
('Her sister experiences recurrent seizures.','seizures','family',['sister']),
('The patient\'s brother has asthma.','asthma','family',['brother']),
('A grandmother had hallucinations in later life.','hallucinations','family',['grandmother']),
('Her son reports frequent headaches.','headaches','family',['son']),
('The daughter has a persistent cough.','cough','family',['daughter']),
('A maternal uncle has Parkinson disease.','Parkinson disease','family',['maternal uncle']),
('The roommate has a fever.','fever','other',['roommate']),
('A coworker reports nausea.','nausea','other',['coworker']),
('The caregiver has chronic back pain.','back pain','other',['caregiver']),
('A neighbor experiences dizziness.','dizziness','other',['neighbor']),
('The nurse describes her own migraine.','migraine','other',['nurse','her own']),
('A visiting friend has an active cough.','cough','other',['friend']),
('Another resident is experiencing agitation.','agitation','other',['Another resident']),
('The clinician\'s colleague has pneumonia.','pneumonia','other',['colleague']),
('The patient reports chest pain.','chest pain','patient',['patient']),
('She describes her own depression.','depression','patient',['She','her own']),
('He is experiencing headaches.','headaches','patient',['He']),
('The patient herself has a fever.','fever','patient',['patient herself']),
('His mother reports that he has seizures.','seizures','patient',['he']),
('Her daughter says the patient has hallucinations.','hallucinations','patient',['patient']),
('The patient has nausea, unlike her healthy sister.','nausea','patient',['patient']),
('The mother has asthma but the patient has a cough.','cough','patient',['patient']),
]


def cases():
    output=[]
    for group,items in [('assertion',ASSERTION),('temporality',TEMPORALITY),('experiencer',EXPERIENCER)]:
        for i,(text,anchor,label,cues) in enumerate(items):
            s=text.index(anchor)
            spans=[]
            for cue in cues:
                cs=text.index(cue);spans.append({'start':cs,'end':cs+len(cue),'text':cue})
            output.append({'id':f'{group}-{i+1:02d}','sentenceId':text,'text':text,'anchor':{'start':s,'end':s+len(anchor),'text':anchor},'group':group,'labels':LABELS[group],'expectedLabel':label,'cueSpans':spans,'scopeChallenge':group=='assertion' and i>=40 or group=='experiencer' and i>=20})
    assert len(output)==96
    return output
