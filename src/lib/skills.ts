import type { Skill } from '../types'
import { repoFilePath, safePathSegment } from './folders'

/**
 * The skill directory reuses the library folder directly:
 * skills/<folder>/<skill-name>/SKILL.md
 * Extra files (scripts/, references/) stay in the same skill directory.
 */
export function skillFilePath(
  skill: Pick<Skill, 'id' | 'name'> & { folder?: string | null },
  skillsDir = 'skills',
): string {
  return repoFilePath(
    skillsDir,
    skill.folder,
    `${safePathSegment(skill.name, skill.id)}/SKILL.md`,
  )
}

export function skillDirectoryPath(
  skill: Pick<Skill, 'id' | 'name'> & { folder?: string | null },
  skillsDir = 'skills',
): string {
  return repoFilePath(skillsDir, skill.folder, safePathSegment(skill.name, skill.id))
}

/** Detect scripts when a skill is edited locally; used for the sync risk flag */
export function skillHasScripts(instructions: string): boolean {
  return /```(?:bash|sh|zsh|python|node|js|ts)\b/i.test(instructions)
}
