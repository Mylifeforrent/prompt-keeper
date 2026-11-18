import type { Skill } from '../types'
import { repoFilePath, safePathSegment } from './folders'

/**
 * 技能目录直接复用库内文件夹：
 * skills/<folder>/<skill-name>/SKILL.md
 * 额外文件（scripts/、references/）保留在同一技能目录下。
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

/** 本地编辑技能时判断是否含脚本，用于同步风险标记 */
export function skillHasScripts(instructions: string): boolean {
  return /```(?:bash|sh|zsh|python|node|js|ts)\b/i.test(instructions)
}
