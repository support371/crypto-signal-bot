import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function reviewedMigrationNames(names) {
  const result = names.filter((name) => {
    const match=/^(\d{3})_.*\.sql$/.exec(name);
    if(!match)return false;
    const n=Number(match[1]);return n>=3 && n<=30 || n===33 || n===34;
  }).sort();
  if(result.length!==31 || result[0]!=='003_live_release_authorizations.sql'
    || result.at(-1)!=='034_live_partial_fill_reservation_release.sql') throw new Error('REVIEWED_MIGRATION_SET_INCOMPLETE');
  return result;
}
export function reviewedMigrationFiles(names) {
  return reviewedMigrationNames(names).map((name,index)=>({source:name,
    target:`${String(index+1).padStart(4,'0')}_${name}`}));
}
export async function prepareReviewedMigrations(root=fileURLToPath(new URL('../',import.meta.url))) {
  const source=path.join(root,'worker','migrations');
  const destination=path.join(root,'worker','.wrangler','reviewed-migrations');
  const files=reviewedMigrationFiles(await fs.readdir(source));
  const names=files.map((file)=>file.target);
  await fs.mkdir(destination,{recursive:true});
  const existing=await fs.readdir(destination);
  if(existing.some((name)=>!names.includes(name))) throw new Error('REVIEWED_MIGRATION_DIRECTORY_CONTAMINATED');
  for(const file of files) await fs.copyFile(path.join(source,file.source),path.join(destination,file.target));
  return {directory:destination,migrationCount:names.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await prepareReviewedMigrations()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
